import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorBannerStyle, inputStyle, primaryButtonStyle } from './LoginPage';
import Spinner from '../components/shared/Spinner';
import logoLight from '../assets/huddle-lockup-barlow-light.svg';
import logoDark from '../assets/huddle-lockup-barlow-dark.svg';
import LegalLinks from '../components/shared/LegalLinks';
import { FIELD_LIMITS } from '../utils/fieldLimits';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  // marketing/index.html's "Go Pro" button links here as /register?plan=pro. Carrying that intent
  // through registration is what lets a household who arrived wanting to pay land on the billing
  // screen after confirming their email, rather than on Log with no idea where to go next.
  // Anything other than the exact value is ignored -- this is a hint from a URL, not a
  // capability, and it grants nothing.
  const [searchParams] = useSearchParams();
  const wantsPro = searchParams.get('plan') === 'pro';
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
      navigate('/confirm-email', { state: { email: trimmedEmail, wantsPro } });
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
          width: 560,
          maxWidth: '100%',
          boxShadow: 'var(--shadow-2), var(--elevation-hairline)',
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

        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-1)', textAlign: 'center' }}>Create your household</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)', textAlign: 'center' }}>
          You'll be the primary login -- kids and training partners get added inside the app, no login needed.
        </div>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        <label style={labelStyle}>Your name</label>
        <input
          placeholder="e.g. Alex"
          maxLength={FIELD_LIMITS.personName}
          value={personName}
          onChange={(e) => {
            setPersonName(e.target.value);
            if (personNameError) setPersonNameError(false);
          }}
          className={`input ${personNameError ? 'input-invalid' : ''}`} style={inputStyle}
        />
        {personNameError && <div style={fieldErrorStyle}>Enter your name.</div>}

        <label style={labelStyle}>Household name (optional)</label>
        <input
          placeholder="Defaults to “{name}'s Household”"
          value={accountName}
          maxLength={FIELD_LIMITS.accountName}
          onChange={(e) => setAccountName(e.target.value)}
          className="input" style={inputStyle}
        />

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          id="email"
          name="email"
          autoComplete="username"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(false);
          }}
          className={`input ${emailError ? 'input-invalid' : ''}`} style={inputStyle}
        />
        {emailError && <div style={fieldErrorStyle}>Enter your email address.</div>}

        <label style={labelStyle}>Password</label>
        <input
          type="password"
          id="password"
          name="new-password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          maxLength={FIELD_LIMITS.password}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (passwordError) setPasswordError(false);
          }}
          className={`input ${passwordError ? 'input-invalid' : ''}`} style={inputStyle}
        />
        {passwordError && <div style={fieldErrorStyle}>Password must be at least 8 characters.</div>}

        <button type="submit" disabled={submitting} className="btn btn-primary btn-lg btn-full pressable" style={{ ...primaryButtonStyle, position: 'relative' }}>
          <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Create household</span>
          {submitting && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner color="currentColor" />
            </span>
          )}
        </button>

        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-4)', textAlign: 'center' }}>
          By creating a household, you agree to our <LegalLinks />.
        </div>

        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-5)', textAlign: 'center' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--color-accent-text)', fontWeight: 'var(--weight-semibold)' }}>Log in</Link>
        </div>
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
