import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { inputStyle, primaryButtonStyle } from './LoginPage';
import Spinner from '../components/shared/Spinner';
import logoLight from '../assets/huddle-lockup-barlow-light.svg';
import logoDark from '../assets/huddle-lockup-barlow-dark.svg';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [personName, setPersonName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await register({ accountName, email, password, personName });
      navigate('/app/log');
    } catch (err) {
      setError(err.message || 'Could not register');
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
          width: 560,
          maxWidth: '100%',
          boxShadow: '0 8px 24px rgba(28,27,25,0.06)',
        }}
      >
        <picture>
          <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
          <img
            src={logoLight}
            alt="Huddle"
            style={{ display: 'block', margin: '0 auto 24px', width: 445, maxWidth: '100%', height: 'auto' }}
          />
        </picture>

        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>Create your household</div>
        <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 24, textAlign: 'center' }}>
          You'll be the primary login -- kids and training partners get added inside the app, no login needed.
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

        <label style={labelStyle}>Your name</label>
        <input required placeholder="e.g. Alex" value={personName} onChange={(e) => setPersonName(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>Household name (optional)</label>
        <input
          placeholder="Defaults to “{name}'s Household”"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          style={inputStyle}
        />

        <label style={labelStyle}>Email</label>
        <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>Password</label>
        <input
          type="password"
          required
          minLength={8}
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />

        <button type="submit" disabled={submitting} style={{ ...primaryButtonStyle, position: 'relative' }}>
          <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Create household</span>
          {submitting && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color={primaryButtonStyle.color} />
            </span>
          )}
        </button>

        <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 18, textAlign: 'center' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>Log in</Link>
        </div>
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
