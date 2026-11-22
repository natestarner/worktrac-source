import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import ProviderButtons from './ProviderButtons';
import HuddleMark from '../shared/HuddleMark';
import { availableSignInProviders } from '../../lib/native';
import { lastSignInMethod, rememberSignInMethod } from '../../lib/lastSignInMethod';
import LegalLinks from '../shared/LegalLinks';
import { errorBannerStyle, fieldLabelStyle } from './authStyles';

/**
 * "Continue with Apple / Google" on the Login and Register pages, and everything after the
 * provider answers: signing in, the household picker, or -- for somebody new -- asking their name.
 *
 * Props:
 * - `onSignedIn()`: a session is live (navigate into the app).
 * - `onNeedsChoice({ accounts, selectionToken })`: two or more households; the page shows the same
 *   AccountPicker a password sign-in does.
 * - `onSignUpStep(active)`: the name step is (or stops being) on screen, so the page can hide its
 *   password form. Rendered OUTSIDE that form: the name step is a form of its own, and forms can't
 *   nest (Enter would submit the wrong one).
 * - `accountNoun`: 'Household' (default) or 'Account' for a Pro-intent arrival, mirroring
 *   RegisterPage: a blank name becomes "{name}'s Account", sent explicitly, rather than falling
 *   through to the server's "'s Household" default.
 *
 * The two other answers the server gives are shown here, in words the person can act on:
 * an existing login with this email ("sign in with your password, then connect it in Profile"),
 * and SIGN_UP_REQUIRED, which swaps the buttons for a short name form and resubmits the SAME token.
 *
 * Online-only by nature, like the password form beside it: signing in mints a session and there is
 * nothing to queue. Offline the provider's sheet or the request fails and the message says so; no
 * connectivity branch (resilience.md's register, "Signing in with Apple or Google").
 */
export default function SocialSignIn({ onSignedIn, onNeedsChoice, onSignUpStep, accountNoun = 'Household' }) {
  const { signInWithIdToken } = useAuth();
  // { message, code? } or null. `code` is a provider's own failure code, shown small for support.
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // { provider, token } while a new person is giving their name. Component state on purpose: the
  // ID token is a credential and must not outlive this screen (same argument as the selection
  // token in LoginPage).
  const [signUp, setSignUp] = useState(null);
  // Which attempt is current. Starting one, or abandoning one from the overlay, moves it on, and an
  // attempt that is no longer current never touches this screen's state again (see finish()).
  const attemptRef = useRef(0);

  if (availableSignInProviders().length === 0) return null;

  // Never rejects: every outcome lands in the catch, so a caller may fire and forget it.
  async function finish(provider, token, details) {
    const attempt = ++attemptRef.current;
    const isCurrent = () => attempt === attemptRef.current;
    setError(null);
    setBusy(true);
    try {
      const choice = await signInWithIdToken(provider, { idToken: token.idToken, nonce: token.nonce, ...details });
      // The server accepted this provider for this person (signed in, or a household to pick), so it
      // is the button to point at next time -- even if the attempt was abandoned meanwhile.
      rememberSignInMethod(provider);
      if (!isCurrent()) {
        // Abandoned from the overlay, then it landed anyway. With no choice to make the session is
        // already live (AuthContext has switched), so the app is the only honest place to go. A
        // household picker nobody is waiting for is just dropped; signing in again shows it.
        if (!choice) onSignedIn();
        return;
      }
      setSignUp(null);
      if (choice) onNeedsChoice(choice);
      else onSignedIn();
    } catch (err) {
      if (!isCurrent()) return;
      if (err?.code === 'SIGN_UP_REQUIRED') {
        setSignUp({ provider, token });
        onSignUpStep?.(true);
      } else {
        setSignUp(null);
        onSignUpStep?.(false);
        setError({ message: err?.message || "Couldn't sign you in. Please try again." });
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  // The overlay's way out, for an attempt that has run past anything legitimate. The request may
  // still be in flight -- nothing can recall it -- so this only stops waiting for it: the screen
  // comes back, and a late answer is handled as finish() says above.
  function abandon() {
    attemptRef.current += 1;
    setBusy(false);
    setError({ message: "That's taking longer than it should. Please try again." });
  }

  // The overlay is `busy`, and nothing else can keep it up. Three things take it down, and each is
  // enough on its own:
  //  1. finish()'s `finally`, whatever the attempt's outcome (success, failure, picker, name step).
  //  2. Leaving the page: on success the page navigates away, unmounting this component and the
  //     overlay with it.
  //  3. The overlay's own "Start over" button, shown after SIGNING_IN_ESCAPE_MS, which does not
  //     depend on the attempt ever finishing. The requests underneath are time-limited, but reading
  //     a response body, /me after it and IndexedDB (restoreOutbox) are not, so (1) is not trusted
  //     to be enough by itself.
  const overlay = busy && (
    <SigningInOverlay
      label={signUp ? `Creating your ${accountNoun.toLowerCase()}…` : 'Signing you in…'}
      onAbandon={abandon}
    />
  );

  if (signUp) {
    return (
      <>
        {overlay}
        <SignUpDetails
          givenName={signUp.token.givenName}
          accountNoun={accountNoun}
          busy={busy}
          error={error}
          onCancel={() => { setSignUp(null); setError(null); onSignUpStep?.(false); }}
          onSubmit={(details) => finish(signUp.provider, signUp.token, details)}
        />
      </>
    );
  }

  return (
    <div>
      {overlay}
      <div style={dividerStyle} aria-hidden="true">
        <span style={dividerLineStyle} />
        <span>or</span>
        <span style={dividerLineStyle} />
      </div>
      <SignInError error={error} />
      <ProviderButtons
        size="large"
        disabled={busy}
        lastUsed={lastSignInMethod()}
        // Not returned: ProviderButton keeps its own button disabled until onToken settles, so
        // handing it the attempt would leave that button disabled for as long as a stuck attempt
        // runs -- even after "Start over". `busy` (disabled above) covers the attempt instead.
        onToken={(provider, token) => { finish(provider, token, {}); }}
        onError={(err) => setError(providerErrorForScreen(err))}
      />
    </div>
  );
}

// After this long, the overlay adds a line saying it is still working (a cold backend can take
// ~35s to answer).
export const SIGNING_IN_SLOW_MS = 5000;

// After this long, the overlay offers "Start over". Past the longest legitimate attempt: the
// sign-in request's 45s limit (AUTH_TIMEOUT_MS) plus /me's 15s inside establishSession. Earlier
// would let someone abandon a cold start that was about to succeed.
export const SIGNING_IN_ESCAPE_MS = 60000;

// Covers the whole screen from the moment Apple / Google hands back until the app (or the household
// picker, or an error) replaces it, so the login form never sits there looking idle. Opaque and
// above the form, so nothing under it can be tapped mid-sign-in.
//
// Portalled to <body> so no ancestor (a transform, an overflow clip) can shrink or hide it. It
// still unmounts with this component. Its only state is two display timers, both cleared on
// unmount.
function SigningInOverlay({ label, onAbandon }) {
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

// A new person: what to call them, and (optionally) the household. Same fields and caps as the
// Register form, which this replaces for an Apple / Google sign-up.
function SignUpDetails({ givenName, accountNoun, busy, error, onCancel, onSubmit }) {
  const [personName, setPersonName] = useState(givenName ?? '');
  const [accountName, setAccountName] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!personName.trim()) return;
    const name = personName.trim();
    const fallback = accountNoun === 'Account' ? `${name}'s Account` : undefined;
    onSubmit({ personName: name, accountName: accountName.trim() || fallback });
  }

  return (
    <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--space-2)' }}>Welcome to Huddle</h2>
      <p style={{ color: 'var(--color-muted)', fontSize: 'var(--text-sm)', margin: '0 0 var(--space-4)' }}>
        One more thing before we set up your {accountNoun.toLowerCase()}.
      </p>
      <SignInError error={error} />
      <label htmlFor="signup-person-name" style={fieldLabelStyle}>Your name</label>
      <input
        id="signup-person-name"
        className="input"
        required
        maxLength={100}
        autoComplete="given-name"
        value={personName}
        onChange={(e) => setPersonName(e.target.value)}
        style={{ marginBottom: 'var(--space-3)' }}
      />
      <label htmlFor="signup-account-name" style={fieldLabelStyle}>{accountNoun} name (optional)</label>
      <input
        id="signup-account-name"
        className="input"
        maxLength={200}
        placeholder={personName.trim() ? `Defaults to ${personName.trim()}'s ${accountNoun}` : ''}
        value={accountName}
        onChange={(e) => setAccountName(e.target.value)}
        style={{ marginBottom: 'var(--space-4)' }}
      />
      <button type="submit" disabled={busy || !personName.trim()} className="btn btn-primary btn-lg btn-full pressable">
        {busy ? `Creating your ${accountNoun.toLowerCase()}…` : `Create my ${accountNoun.toLowerCase()}`}
      </button>
      {/* The agreement sits under the button that creates the account, because this is where an
          Apple / Google sign-up actually happens -- and it can be reached from the Log in page, which
          (unlike Register) shows no Terms of its own. */}
      <p className="signup-consent">
        By creating your {accountNoun.toLowerCase()}, you agree to our <LegalLinks />.
      </p>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="btn btn-secondary btn-lg btn-full pressable"
        style={{ marginTop: 'var(--space-3)' }}
      >
        Back
      </button>
    </form>
  );
}

// A provider's failure in the words lib/native wrote for people (`signInFailure`), with its code;
// anything else that reaches onError (a missing test hook, an unexpected throw) gets one plain
// sentence rather than a developer's message.
function providerErrorForScreen(err) {
  if (err?.signInFailure) return { message: err.message, code: err.code };
  return { message: "Couldn't sign you in. Please try again." };
}

// The message first, in plain words; the code underneath, small, for anyone writing to support.
function SignInError({ error }) {
  if (!error) return null;
  return (
    <div role="alert" style={errorBannerStyle}>
      {error.message}
      {error.code && <span className="sign-in-error-code">Error code: {error.code}</span>}
    </div>
  );
}

const dividerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  margin: 'var(--space-5) 0 var(--space-4)',
  color: 'var(--color-muted)',
  fontSize: 'var(--text-sm)',
};

const dividerLineStyle = { flex: 1, height: 1, background: 'var(--color-border)' };
