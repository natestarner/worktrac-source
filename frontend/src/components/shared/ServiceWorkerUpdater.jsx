import { useState, useSyncExternalStore } from 'react';
import { applyUpdate, isUpdateAvailable, subscribeUpdateAvailable } from '../../lib/swUpdate';

// Fallback surface for "a new version is ready" -- AppShell/LogTab's forced-reload triggers
// (person/section/exercise switch, ending a workout, tab visibility regained) apply a pending
// update automatically at the next safe pause point, so most users never see this. It only matters
// for someone who parks on one screen for a long session without navigating anywhere. Never
// reloads on its own even then -- the user chooses when, so an active set is never interrupted.
export default function ServiceWorkerUpdater() {
  const available = useSyncExternalStore(subscribeUpdateAvailable, isUpdateAvailable, () => false);
  // Local to this component, deliberately separate from the shared `available` flag -- dismissing
  // only hides THIS banner. It must NOT clear `available`, or a forced-reload trigger firing a
  // moment later (switching person/section/exercise, ending a workout) would have nothing to apply.
  const [dismissed, setDismissed] = useState(false);

  if (!available || dismissed) return null;

  return (
    <div
      role="dialog"
      aria-label="Update available"
      style={{
        position: 'fixed',
        left: 'var(--space-4)',
        right: 'var(--space-4)',
        // Clears the home indicator on a standalone-display PWA; resolves to plain
        // --space-4 anywhere there's no inset.
        bottom: 'calc(var(--space-4) + env(safe-area-inset-bottom))',
        margin: '0 auto',
        maxWidth: 420,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        // Was var(--color-card-bg, #fff) -- that token has never existed, so this
        // always fell through to hard white and rendered a white card with
        // near-white text in dark mode.
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        boxShadow: 'var(--shadow-3), var(--elevation-hairline)',
        border: '1px solid var(--color-border)',
        zIndex: 1000,
        animation: 'slideUpIn var(--dur-slow) var(--ease-out)',
      }}
    >
      <span style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
        A new version is available.
      </span>
      <button
        type="button"
        className="pressable"
        onClick={() => applyUpdate()}
        style={{
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-full)',
          border: 'none',
          background: 'var(--color-accent-strong)',
          color: 'var(--color-accent-contrast)',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-semibold)',
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
      <button
        type="button"
        className="pressable pressable-subtle"
        onClick={() => setDismissed(true)}
        style={{
          padding: 'var(--space-2) var(--space-3)',
          borderRadius: 'var(--radius-full)',
          border: '1px solid var(--color-border)',
          background: 'transparent',
          color: 'var(--color-muted)',
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-semibold)',
          cursor: 'pointer',
        }}
      >
        Later
      </button>
    </div>
  );
}
