import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { inputStyle, primaryButtonStyle } from './LoginPage';
import Spinner from '../components/shared/Spinner';

const RESEND_COOLDOWN_SECONDS = 60;

export default function ConfirmEmailPage() {
  const { confirmEmail, resendCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email;

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Reloading loses router state -- this page can't function without knowing which email to
  // confirm, so send the user back to start registration again rather than show a dead form.
  if (!email) {
    return <Navigate to="/register" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setCodeError(true);
      return;
    }

    setSubmitting(true);
    try {
      await confirmEmail({ email, code: trimmedCode });
      navigate('/app/log');
    } catch (err) {
      setError(err.message || 'Could not confirm this code');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError('');
    setJustSent(false);
    setResending(true);
    try {
      await resendCode({ email });
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setJustSent(true);
    } catch (err) {
      setError(err.message || 'Could not resend the code');
    } finally {
      setResending(false);
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
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>Check your email</div>
        <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 24, textAlign: 'center' }}>
          Enter the 6-digit code we sent to {email}.
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

        <label style={labelStyle}>Verification code</label>
        <input
          autoFocus
          inputMode="numeric"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''));
            if (codeError) setCodeError(false);
          }}
          style={{
            ...inputStyle,
            ...(codeError ? { border: '1px solid var(--color-danger)', marginBottom: 6 } : {}),
            textAlign: 'center',
            fontSize: 24,
            letterSpacing: '0.3em',
          }}
        />
        {codeError && <div style={fieldErrorStyle}>Enter the 6-digit code.</div>}

        <button type="submit" disabled={submitting} style={{ ...primaryButtonStyle, position: 'relative' }}>
          <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Confirm</span>
          {submitting && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color={primaryButtonStyle.color} />
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          style={{
            position: 'relative',
            width: '100%',
            padding: 12,
            marginTop: 10,
            background: 'transparent',
            color: resending || cooldown > 0 ? 'var(--color-muted)' : 'var(--color-accent)',
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
            cursor: resending || cooldown > 0 ? 'default' : 'pointer',
          }}
        >
          <span style={{ visibility: resending ? 'hidden' : 'visible' }}>
            {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
          </span>
          {resending && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color="var(--color-muted)" />
            </span>
          )}
        </button>
        {justSent && cooldown > 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-muted)', textAlign: 'center', marginTop: 6 }}>
            New code sent.
          </div>
        )}
      </form>
    </div>
  );
}

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 6,
};

const fieldErrorStyle = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-danger)',
  marginBottom: 16,
};
