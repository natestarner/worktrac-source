import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorBannerStyle, inputStyle, primaryButtonStyle } from './LoginPage';
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
        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-1)', textAlign: 'center' }}>Check your email</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)', textAlign: 'center' }}>
          Enter the 6-digit code we sent to {email}.
        </div>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        <label style={labelStyle}>Verification code</label>
        <input
          autoFocus
          id="verification-code"
          name="one-time-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''));
            if (codeError) setCodeError(false);
          }}
          className={`input ${codeError ? 'input-invalid' : ''}`}
          style={{
            ...inputStyle,
            textAlign: 'center',
            // Deliberate one-off, outside the type scale: a 6-digit code read back off a
            // phone is the whole job of this screen, and the tracking below only works at
            // a display size. --text-2xl would overflow the 380px card at this tracking.
            fontSize: 24,
            letterSpacing: '0.3em',
          }}
        />
        {codeError && <div style={fieldErrorStyle}>Enter the 6-digit code.</div>}

        <button type="submit" disabled={submitting} className="btn btn-primary btn-lg btn-full pressable" style={{ ...primaryButtonStyle, position: 'relative' }}>
          <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Confirm</span>
          {submitting && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color="currentColor" />
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
            minHeight: 44,
            padding: 'var(--space-3)',
            marginTop: 'var(--space-2)',
            background: 'transparent',
            color: resending || cooldown > 0 ? 'var(--color-muted)' : 'var(--color-accent-text)',
            border: 'none',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
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
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textAlign: 'center', marginTop: 'var(--space-2)' }}>
            New code sent.
          </div>
        )}
      </form>
    </div>
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
