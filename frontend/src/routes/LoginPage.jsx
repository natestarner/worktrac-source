import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/shared/Spinner';
import logoLight from '../assets/huddle-lockup-barlow-light.svg';
import logoDark from '../assets/huddle-lockup-barlow-dark.svg';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const successMessage = location.state?.message;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/app/log');
    } catch (err) {
      setError(err.message || 'Could not log in');
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
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-10) var(--space-8)',
          width: 560,
          maxWidth: '92vw',
          textAlign: 'center',
          boxShadow: 'var(--shadow-2), var(--elevation-hairline)',
        }}
      >
        <picture>
          <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
          <img
            src={logoLight}
            alt="Workout Tracker"
            style={{ width: 445, maxWidth: '100%', height: 'auto', marginBottom: 40 }}
          />
        </picture>

        {successMessage && (
          <div role="status" style={successBannerStyle}>
            {successMessage}
          </div>
        )}

        {/* Was rendering on --color-pr-bg -- the personal-record celebration peach. A
            failure and an achievement must never share a colour. */}
        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        {/* This page had no labels at all, only placeholders -- which vanish the moment
            you start typing, and leave a screen reader announcing an unlabelled field. */}
        <div style={{ textAlign: 'left', marginBottom: 'var(--space-3)' }}>
          <label htmlFor="email" style={fieldLabelStyle}>
            Email
          </label>
          <input
            type="email"
            id="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </div>
        <div style={{ textAlign: 'left', marginBottom: 'var(--space-2)' }}>
          <label htmlFor="password" style={fieldLabelStyle}>
            Password
          </label>
          <input
            type="password"
            id="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
        </div>

        <div style={{ textAlign: 'right', marginBottom: 'var(--space-4)' }}>
          <Link to="/forgot-password" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
            Forgot password?
          </Link>
        </div>

        <button type="submit" disabled={submitting} className="btn btn-primary btn-lg btn-full pressable" style={{ position: 'relative' }}>
          <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Log in</span>
          {submitting && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color="currentColor" />
            </span>
          )}
        </button>

        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-5)' }}>
          New household?{' '}
          <Link to="/register" style={{ color: 'var(--color-accent-text)', fontWeight: 'var(--weight-semibold)' }}>
            Register
          </Link>
        </div>
      </form>
    </div>
  );
}

// Shared by the other four auth pages. inputStyle is kept as a thin wrapper over the
// .input class rather than deleted, because those pages compose it with per-field
// overrides; the 16px font size lives in the class and must stay there or iOS Safari
// zooms the viewport on focus.
export const inputStyle = {
  marginBottom: 'var(--space-3)',
};

export const primaryButtonStyle = {
  marginTop: 'var(--space-2)',
};

export const fieldLabelStyle = {
  display: 'block',
  marginBottom: 'var(--space-1)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-label)',
};

const bannerBase = {
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3) var(--space-4)',
  fontSize: 'var(--text-sm)',
  marginBottom: 'var(--space-4)',
  textAlign: 'left',
  border: '1px solid transparent',
};

export const successBannerStyle = {
  ...bannerBase,
  background: 'var(--color-success-bg)',
  borderColor: 'var(--color-success)',
  color: 'var(--color-text)',
};

export const errorBannerStyle = {
  ...bannerBase,
  background: 'var(--color-danger-bg)',
  borderColor: 'var(--color-danger-border)',
  color: 'var(--color-danger)',
};
