import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/shared/Spinner';
import logoLight from '../assets/huddle-lockup-barlow-light.svg';
import logoDark from '../assets/huddle-lockup-barlow-dark.svg';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
          borderRadius: 20,
          padding: '48px 40px',
          width: 560,
          maxWidth: '92vw',
          textAlign: 'center',
          boxShadow: '0 8px 24px rgba(28,27,25,0.06)',
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

        {error && (
          <div
            style={{
              background: 'var(--color-pr-bg)',
              color: 'var(--color-danger)',
              borderRadius: 10,
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 16,
              textAlign: 'left',
            }}
          >
            {error}
          </div>
        )}

        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />

        <button type="submit" disabled={submitting} style={{ ...primaryButtonStyle, position: 'relative' }}>
          <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Log in</span>
          {submitting && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color={primaryButtonStyle.color} />
            </span>
          )}
        </button>

        <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 18 }}>
          New household? <Link to="/register" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>Register</Link>
        </div>
      </form>
    </div>
  );
}

export const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 14,
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  fontSize: 16,
  marginBottom: 12,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
};

export const primaryButtonStyle = {
  width: '100%',
  padding: 16,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-contrast)',
  border: 'none',
  borderRadius: 12,
  fontSize: 17,
  fontWeight: 600,
  cursor: 'pointer',
  marginTop: 6,
};
