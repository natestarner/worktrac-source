import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { inputStyle, primaryButtonStyle } from './LoginPage';
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
        padding: 24,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 20,
          padding: '40px 36px',
          width: 380,
          maxWidth: '100%',
          boxShadow: '0 8px 24px rgba(28,27,25,0.06)',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>Reset your password</div>
        <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 24, textAlign: 'center' }}>
          Enter your email and we'll send you a code to reset your password.
        </div>

        {error && (
          <div
            style={{
              background: 'var(--color-pr-bg)',
              color: 'var(--color-danger)',
              borderRadius: 10,
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
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
          style={inputStyle}
        />

        <button type="submit" disabled={submitting} style={{ ...primaryButtonStyle, position: 'relative' }}>
          <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Send reset code</span>
          {submitting && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color={primaryButtonStyle.color} />
            </span>
          )}
        </button>

        <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 18, textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>Back to login</Link>
        </div>
      </form>
    </div>
  );
}
