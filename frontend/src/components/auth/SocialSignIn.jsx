import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import ProviderButtons from './ProviderButtons';
import { availableSignInProviders } from '../../lib/native';
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // { provider, token } while a new person is giving their name. Component state on purpose: the
  // ID token is a credential and must not outlive this screen (same argument as the selection
  // token in LoginPage).
  const [signUp, setSignUp] = useState(null);

  if (availableSignInProviders().length === 0) return null;

  async function finish(provider, token, details) {
    setError('');
    setBusy(true);
    try {
      const choice = await signInWithIdToken(provider, { idToken: token.idToken, nonce: token.nonce, ...details });
      setSignUp(null);
      if (choice) onNeedsChoice(choice);
      else onSignedIn();
    } catch (err) {
      if (err?.code === 'SIGN_UP_REQUIRED') {
        setSignUp({ provider, token });
        onSignUpStep?.(true);
      } else {
        setSignUp(null);
        onSignUpStep?.(false);
        setError(err?.message || "Couldn't sign you in. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (signUp) {
    return (
      <SignUpDetails
        givenName={signUp.token.givenName}
        accountNoun={accountNoun}
        busy={busy}
        error={error}
        onCancel={() => { setSignUp(null); setError(''); onSignUpStep?.(false); }}
        onSubmit={(details) => finish(signUp.provider, signUp.token, details)}
      />
    );
  }

  return (
    <div>
      <div style={dividerStyle} aria-hidden="true">
        <span style={dividerLineStyle} />
        <span>or</span>
        <span style={dividerLineStyle} />
      </div>
      {error && (
        <div role="alert" style={errorBannerStyle}>
          {error}
        </div>
      )}
      <ProviderButtons
        disabled={busy}
        onToken={(provider, token) => finish(provider, token, {})}
        onError={(err) => setError(err?.message ? `Couldn't sign you in: ${err.message}` : "Couldn't sign you in.")}
      />
    </div>
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
      {error && (
        <div role="alert" style={errorBannerStyle}>
          {error}
        </div>
      )}
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

const dividerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  margin: 'var(--space-5) 0 var(--space-4)',
  color: 'var(--color-muted)',
  fontSize: 'var(--text-sm)',
};

const dividerLineStyle = { flex: 1, height: 1, background: 'var(--color-border)' };
