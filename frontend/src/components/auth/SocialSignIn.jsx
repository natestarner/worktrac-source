import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import ProviderButtons from './ProviderButtons';
import SigningInOverlay from './SigningInOverlay';
import { useSigningIn } from './useSigningIn';
import { availableSignInProviders } from '../../lib/native';

export { SIGNING_IN_ESCAPE_MS, SIGNING_IN_MIN_MS, SIGNING_IN_SLOW_MS } from './useSigningIn';
import {
  describeSignInMethods,
  lastSignInMethod,
  rememberSignInMethod,
  usedSignInMethods,
} from '../../lib/lastSignInMethod';
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
  // `busy` shows the overlay and nothing else does. Starting an attempt, or abandoning one from the
  // overlay, moves the current attempt on, and one that is no longer current never touches this
  // screen's state again (see finish()).
  const { busy, begin, abandon: abandonAttempt } = useSigningIn();
  // { provider, token } while a new person is giving their name. Component state on purpose: the
  // ID token is a credential and must not outlive this screen (same argument as the selection
  // token in LoginPage).
  const [signUp, setSignUp] = useState(null);

  if (availableSignInProviders().length === 0) return null;

  // Never rejects: every outcome lands in the catch, so a caller may fire and forget it.
  async function finish(provider, token, details) {
    const attempt = begin();
    const { isCurrent } = attempt;
    setError(null);
    try {
      const choice = await signInWithIdToken(provider, { idToken: token.idToken, nonce: token.nonce, ...details });
      // The server accepted this provider for this person (signed in, or a household to pick), so it
      // is the button to point at next time -- even if the attempt was abandoned meanwhile.
      rememberSignInMethod(provider);
      if (isCurrent()) await attempt.settled();
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
      if (isCurrent()) await attempt.settled();
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
      attempt.end();
    }
  }

  // The overlay's way out, for an attempt that has run past anything legitimate. The request may
  // still be in flight -- nothing can recall it -- so this only stops waiting for it: the screen
  // comes back, and a late answer is handled as finish() says above.
  function abandon() {
    abandonAttempt();
    setError({ message: "That's taking longer than it should. Please try again." });
  }

  // The overlay is `busy`, and nothing else can keep it up. Its three independent exits are listed
  // in SigningInOverlay.jsx: finish()'s `finally`, this page unmounting, and "Start over".
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
          provider={signUp.provider}
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

// A new person: what to call them, and (optionally) the household. Same fields and caps as the
// Register form, which this replaces for an Apple / Google sign-up.
//
// It opens with "Already have a household?", because this step is exactly where the mistake the
// whole sign-in hint exists for lands: the server has just said it doesn't know this person, and
// nothing has been created yet, so Back costs nothing. It works on a device with nothing remembered
// (a new phone, a reinstall), which no on-device hint can. Where this device has signed in some
// OTHER way before, it names that way; otherwise it says "a different way".
function SignUpDetails({ provider, givenName, accountNoun, busy, error, onCancel, onSubmit }) {
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
      <ExistingHouseholdHint provider={provider} />
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

function ExistingHouseholdHint({ provider }) {
  const others = describeSignInMethods(usedSignInMethods().filter((m) => m !== provider));
  return (
    <p className="sign-in-method-hint" data-testid="existing-household-hint" style={{ margin: '0 0 var(--space-4)' }}>
      <strong>Already have a household?</strong>{' '}
      {others ? `You may have signed up with ${others}.` : 'You may have signed up a different way.'}{' '}
      Tap Back and sign in that way instead.
    </p>
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
