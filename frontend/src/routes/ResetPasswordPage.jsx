import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorBannerStyle, inputStyle, primaryButtonStyle } from './LoginPage';
import Spinner from '../components/shared/Spinner';
import { FIELD_LIMITS } from '../utils/fieldLimits';

const RESEND_COOLDOWN_SECONDS = 60;

export default function ResetPasswordPage() {
  const { resetPassword, resendResetCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email;

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
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
  // reset, so send the user back to start the reset request again rather than show a dead form.
  if (!email) {
    return <Navigate to="/forgot-password" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedCode = code.trim();
    let hasError = false;
    if (!/^\d{6}$/.test(trimmedCode)) {
      setCodeError(true);
      hasError = true;
    }
    if (password.length < 8) {
      setPasswordError(true);
      hasError = true;
    }
    if (hasError) return;

    setSubmitting(true);
    try {
      await resetPassword({ email, code: trimmedCode, password });
      navigate('/login', { state: { message: 'Password reset -- sign in with your new password.' } });
    } catch (err) {
      setError(err.message || 'Could not reset your password');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError('');
    setJustSent(false);
    setResending(true);
    try {
      await resendResetCode({ email });
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
          If an account exists for {email}, we've sent a 6-digit reset code. Enter it below with your new password.
        </div>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        <label style={labelStyle}>Reset code</label>
        <input
          autoFocus
          id="reset-code"
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
            // Deliberate one-off, outside the type scale -- see ConfirmEmailPage.
            fontSize: 24,
            letterSpacing: '0.3em',
          }}
        />
        {codeError && <div style={fieldErrorStyle}>Enter the 6-digit code.</div>}

        <label style={labelStyle}>New password</label>
        <input
          type="password"
          id="new-password"
          name="new-password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          maxLength={FIELD_LIMITS.password}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (passwordError) setPasswordError(false);
          }}
          className={`input ${passwordError ? 'input-invalid' : ''}`}
          style={inputStyle}
        />
        {passwordError && <div style={fieldErrorStyle}>Password must be at least 8 characters.</div>}

        <button type="submit" disabled={submitting} className="btn btn-primary btn-lg btn-full pressable" style={{ ...primaryButtonStyle, position: 'relative' }}>
          <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Reset password</span>
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
