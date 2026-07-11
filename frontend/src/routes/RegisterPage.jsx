import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { inputStyle, primaryButtonStyle } from './LoginPage';
import Spinner from '../components/shared/Spinner';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [personName, setPersonName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [personNameError, setPersonNameError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedPersonName = personName.trim();
    const trimmedEmail = email.trim();
    let hasError = false;
    if (!trimmedPersonName) {
      setPersonNameError(true);
      hasError = true;
    }
    if (!trimmedEmail) {
      setEmailError(true);
      hasError = true;
    }
    if (password.length < 8) {
      setPasswordError(true);
      hasError = true;
    }
    if (hasError) return;

    setSubmitting(true);
    try {
      await register({ accountName, email: trimmedEmail, password, personName: trimmedPersonName });
      navigate('/confirm-email', { state: { email: trimmedEmail } });
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
          width: 380,
          maxWidth: '100%',
          boxShadow: '0 8px 24px rgba(28,27,25,0.06)',
        }}
      >
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
        <input
          placeholder="e.g. Alex"
          value={personName}
          onChange={(e) => {
            setPersonName(e.target.value);
            if (personNameError) setPersonNameError(false);
          }}
          style={{ ...inputStyle, ...(personNameError ? errorInputStyle : {}) }}
        />
        {personNameError && <div style={fieldErrorStyle}>Enter your name.</div>}

        <label style={labelStyle}>Household name (optional)</label>
        <input
          placeholder="Defaults to “{name}'s Household”"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          style={inputStyle}
        />

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(false);
          }}
          style={{ ...inputStyle, ...(emailError ? errorInputStyle : {}) }}
        />
        {emailError && <div style={fieldErrorStyle}>Enter your email address.</div>}

        <label style={labelStyle}>Password</label>
        <input
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (passwordError) setPasswordError(false);
          }}
          style={{ ...inputStyle, ...(passwordError ? errorInputStyle : {}) }}
        />
        {passwordError && <div style={fieldErrorStyle}>Password must be at least 8 characters.</div>}

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

const errorInputStyle = {
  border: '1px solid var(--color-danger)',
  marginBottom: 6,
};

const fieldErrorStyle = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-danger)',
  marginBottom: 16,
};
