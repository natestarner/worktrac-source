import { Component } from 'react';
import Button from './Button';
import { recordClientError } from '../../lib/lastClientError';

// The app had no error boundary anywhere, so any render-time throw took the whole screen white --
// which is exactly how docs/incidents/2026-08-08-trends-hover-blank-page.md presented: a persisted
// UI slice predating a new field hydrated as `undefined`, one of two chart call sites indexed a
// metric table directly, and hovering the chart blanked the page.
//
// That class of bug is a *degraded-conditions* bug, not a stray null check. Restored state from an
// earlier app version, a cache entry that survived a schema change, a temp id that never resolved
// -- axis D in .claude/rules/resilience.md -- all surface as an unexpected `undefined` deep in a
// render. The contract says a failure degrades to something usable; a white screen is the one
// outcome that is never acceptable, especially mid-workout on an iPad with no other recourse.
//
// Deliberately NOT wired to any reporting service: there is still no client error pipeline in this
// app, and inventing one here would be a second mechanism nobody asked for. It logs to the console
// (so a real stack survives in dev and in a shared browser session) and gives the person a way out.
//
// It now ALSO stashes the error locally, via lib/lastClientError.js, for the Contact Us form to
// offer. That is not the reporting service ruled out above and does not reopen the question:
// nothing is transmitted, in the background or otherwise. The value sits in localStorage and leaves
// the device only if a person opens Contact Us, sees it listed in that form's "What gets sent"
// disclosure, and chooses to send it. The reason it earns its place is that a render-time throw is
// caught here and reaches Azure in no form whatsoever -- so for a bug report about a blanked
// screen, this stash is frequently the only record the failure ever happened.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught a render error', error, info);
    // Swallows its own failures -- see lib/lastClientError.js. Capturing diagnostics must never be
    // able to turn a contained render error into an uncontained one.
    recordClientError(error, info);
  }

  // Clears a previous screen's error when `resetKey` changes (callers pass the current route), so
  // navigating away from a crashed tab shows the new tab rather than the stale fallback.
  //
  // Deliberately NOT done with `key={pathname}` on the boundary itself, which was the first
  // attempt: a changing key force-remounts the entire subtree on EVERY navigation, not just after
  // an error. That churned the app chrome hard enough that the header menu detached mid-click and
  // multi-person.spec.ts went red -- an error boundary added for resilience was itself
  // destabilising ordinary navigation. Resetting state here touches nothing unless an error is
  // actually being displayed. ErrorBoundary.test.jsx pins both halves.
  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  // Lets a boundary recover in place without a reload, which matters offline: a full reload while
  // offline depends on the service worker having precached the shell, and throws away nothing
  // useful here since queued writes live in IndexedDB, not component state.
  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback({ error: this.state.error, retry: this.handleRetry });
    }

    return (
      <div
        role="alert"
        style={{
          padding: 'var(--space-4)',
          margin: 'var(--space-4) auto',
          maxWidth: 480,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>
          {this.props.title ?? 'Something went wrong on this screen'}
        </div>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-muted)',
            marginBottom: 'var(--space-4)',
          }}
        >
          Anything you&rsquo;ve logged is still saved on this device and will sync. Nothing is lost.
        </div>
        <Button variant="primary" onClick={this.handleRetry}>
          Try again
        </Button>
      </div>
    );
  }
}
