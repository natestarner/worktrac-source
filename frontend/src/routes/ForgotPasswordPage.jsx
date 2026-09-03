import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorBannerStyle, inputStyle, primaryButtonStyle } from './LoginPage';
import Spinner from '../components/shared/Spinner';

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
        minHeight: '100vh',
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
          <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Send reset code</span>
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
