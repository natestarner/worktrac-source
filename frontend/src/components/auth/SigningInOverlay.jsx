import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import HuddleMark from '../shared/HuddleMark';
import { SIGNING_IN_ESCAPE_MS, SIGNING_IN_SLOW_MS } from './useSigningIn';

// The full-screen "Signing you in…" / "Creating your household…" moment, shared by every screen
// that turns a credential into a session in front of the person: Apple / Google (SocialSignIn), the
// password form (LoginPage) and the code that finishes a password registration (ConfirmEmailPage).
// One overlay and one attempt hook, so those screens cannot drift apart in how it looks, how long it
// stays, or -- above all -- how it is escaped. See .claude/rules/social-sign-in.md, "The 'Signing
// you in' overlay must never trap anyone".

// Covers the whole screen from the moment a credential is handed over until the app (or the
// household picker, a name step, or an error) replaces it, so the form never sits there looking
// idle. Opaque and above the form, so nothing under it can be tapped mid-sign-in.
//
// Three things take it down, and each is enough on its own:
//  1. The attempt's `end()` in a `finally`, whatever the outcome.
//  2. Leaving the page: on success the page navigates away, unmounting it.
//  3. Its own "Start over" button, shown after SIGNING_IN_ESCAPE_MS, which does not depend on the
//     attempt ever finishing. The requests underneath are time-limited, but reading a response body,
//     /me after it and IndexedDB (restoreOutbox) are not, so (1) is not trusted to be enough alone.
//
// Portalled to <body> so no ancestor (a transform, an overflow clip) can shrink or hide it. It
// still unmounts with its owner. Its only state is two display timers, both cleared on unmount.
export default function SigningInOverlay({ label, onAbandon }) {
  const [slow, setSlow] = useState(false);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const slowTimer = setTimeout(() => setSlow(true), SIGNING_IN_SLOW_MS);
    const stuckTimer = setTimeout(() => setStuck(true), SIGNING_IN_ESCAPE_MS);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(stuckTimer);
    };
  }, []);

  return createPortal(
    <div className="signing-in-overlay" data-testid="signing-in-overlay">
      <HuddleMark size={88} className="signing-in-overlay__mark" />
      <div role="status" aria-live="polite" className="signing-in-overlay__text">
        <p className="signing-in-overlay__label">{label}</p>
        {slow && <p className="signing-in-overlay__hint">Still working. This can take a little longer sometimes.</p>}
      </div>
      {stuck && (
        <button type="button" className="btn btn-secondary btn-lg pressable signing-in-overlay__escape" onClick={onAbandon}>
          Start over
        </button>
      )}
    </div>,
    document.body,
  );
}
