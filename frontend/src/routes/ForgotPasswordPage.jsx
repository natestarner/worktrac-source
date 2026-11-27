import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorBannerStyle, inputStyle, primaryButtonStyle } from '../components/auth/authStyles';
import Spinner from '../components/shared/Spinner';
import { availableSignInProviders } from '../lib/native';
import { describeSignInMethods, usedSignInMethods } from '../lib/lastSignInMethod';

// The Apple / Google ways in this device has used, but only on a device that has never signed in
// with a password. Someone here may have joined with Apple's "Hide My Email": their account is under
// a relay address they have never seen, so the email they type below matches nothing, and no reset
// email can help them. Only the device can point them back. A device that has also used a password
// says nothing (on a family iPad that is somebody else's password, as likely as not). Providers
// this build no longer offers are not named.
function providersToPointBackAt() {
  const used = usedSignInMethods();
  if (used.includes('password')) return [];
  const offered = availableSignInProviders();
  return used.filter((m) => offered.includes(m));
}

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [providerHint] = useState(() => describeSignInMethods(providersToPointBackAt()));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim();
    // Was a bare `return`, which made an empty submit do nothing at all with no explanation --
    // the only auth form in the app that stayed silent. Every sibling shows an inline field error.
    if (!trimmedEmail) {
      setEmailError(true);
      return;
    }

    setSubmitting(true);
    try {
      // Always resolves, even for an unregistered email -- see requestPasswordReset.
      await requestPasswordReset({ email: trimmedEmail });
      navigate('/reset-password', { state: { email: trimmedEmail } });
    } catch (err) {
      setError(err.message || 'Could not send a reset code');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: 'var(--viewport-min-height)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
        padding: 'var(--space-6)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-10) var(--space-8)',
          width: 380,
          maxWidth: '100%',
          boxShadow: 'var(--shadow-2), var(--elevation-hairline)',
        }}
      >
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', margin: '0 0 var(--space-1)', textAlign: 'center' }}>Reset your password</h1>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)', textAlign: 'center' }}>
          Enter your email and we'll send you a code to reset your password.
        </div>

        {providerHint && (
          <p className="sign-in-method-hint" data-testid="forgot-password-provider-hint" style={{ margin: '0 0 var(--space-5)' }}>
            <strong>Signed up with {providerHint}?</strong> This device has signed in with{' '}
            {providerHint} before. An account made that way has no password to reset: tap Continue
            with {providerHint} on the{' '}
            <Link to="/login" style={{ color: 'var(--color-accent-text)', fontWeight: 'var(--weight-semibold)' }}>
              Log in screen
            </Link>{' '}
            instead.
          </p>
        )}

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        <label htmlFor="email" style={labelStyle}>Email</label>
        {/* Carries no `required`, deliberately: it hands an empty submit to the browser's native
            validation bubble, which never reaches handleSubmit and looks nothing like the app's
            own inline errors. RegisterPage already validates this way and is the neighbouring
            page in the same flow. `required` also only tests for emptiness, so a whitespace-only
            entry fell straight through it into the silent `return` this replaces. */}
        <input
          type="email"
          id="email"
          name="email"
          autoComplete="username"
          autoFocus
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(false);
          }}
          aria-invalid={emailError || undefined}
          aria-describedby={emailError ? 'email-error' : undefined}
          className={`input ${emailError ? 'input-invalid' : ''}`} style={inputStyle}
        />
        {emailError && <div id="email-error" style={fieldErrorStyle}>Enter your email address.</div>}

        <button type="submit" disabled={submitting} className="btn btn-primary btn-lg btn-full pressable" style={{ ...primaryButtonStyle, position: 'relative' }}>
          <span style={{ visibility: submitting ? 'hidden' : undefined }}>Send reset code</span>
          {submitting && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color="currentColor" />
            </span>
          )}
        </button>

        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-5)', textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--color-accent-text)', fontWeight: 'var(--weight-semibold)' }}>Back to login</Link>
        </div>
      </form>
    </main>
  );
}

const labelStyle = {
  display: 'block',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-label)',
  marginBottom: 'var(--space-1)',
};

const fieldErrorStyle = {
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-danger)',
  marginBottom: 'var(--space-4)',
};
