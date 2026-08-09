import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorBannerStyle, inputStyle, primaryButtonStyle } from './LoginPage';
import Spinner from '../components/shared/Spinner';

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;

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
    <div
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
        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-1)', textAlign: 'center' }}>Reset your password</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)', textAlign: 'center' }}>
          Enter your email and we'll send you a code to reset your password.
        </div>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        <input
          type="email"
          autoFocus
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input" style={inputStyle}
        />

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
    </div>
  );
}
