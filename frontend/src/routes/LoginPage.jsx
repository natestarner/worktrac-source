import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/shared/Spinner';
import HouseholdPicker from '../components/auth/HouseholdPicker';
import {
  authCardStyle,
  authPageStyle,
  errorBannerStyle,
  fieldLabelStyle,
  successBannerStyle,
} from '../components/auth/authStyles';
import logoLight from '../assets/huddle-lockup-vertical-onlight.svg';
import logoDark from '../assets/huddle-lockup-vertical-ondark.svg';

export default function LoginPage() {
  const { login, chooseHousehold } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Set only when this credential belongs to two or more households. Holds the five-minute
  // selection token.
  //
  // ⚠️ COMPONENT STATE, deliberately -- not a route, not router state, not storage. A selection
  // token is a credential; router state survives in history and storage survives a reload, and
  // this one should exist for exactly as long as the picker is on screen. A /choose-household
  // route would also be meaningless when reached without it. See api/client.js's bearerOverride
  // for the same argument one layer down.
  const [choice, setChoice] = useState(null);
  const successMessage = location.state?.message;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const needsChoice = await login(email, password);
      if (needsChoice) {
        // Nothing has been signed in and nothing torn down -- whatever session this device already
        // had is still intact, so abandoning the picker costs nothing.
        setChoice(needsChoice);
        return;
      }
      navigate('/app/log');
    } catch (err) {
      setError(err.message || 'Could not log in');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChoose(accountId) {
    setError('');
    setSubmitting(true);
    try {
      await chooseHousehold(accountId, choice.selectionToken);
      navigate('/app/log');
    } catch (err) {
      // The overwhelmingly likely failure is an expired selection token -- five minutes is short
      // on purpose. Say what to do rather than what went wrong.
      setError(err.message || 'That took too long — sign in again to pick a household.');
      setChoice(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (choice) {
    return (
      <HouseholdPicker
        households={choice.households}
        onChoose={handleChoose}
        onCancel={() => { setChoice(null); setError(''); }}
        submitting={submitting}
        error={error}
      />
    );
  }

  return (
    <main style={authPageStyle}>
      <form onSubmit={handleSubmit} style={authCardStyle}>
        <picture>
          <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
          <img
            src={logoLight}
            alt="Huddle"
            style={{ width: 216, maxWidth: '100%', height: 'auto', marginBottom: 40 }}
          />
        </picture>

        {/* No visible title on this page -- the lockup above is the branding. A screen reader
            still needs to know which screen it landed on, and axe's page-has-heading-one flagged
            its absence. */}
        <h1 className="sr-only">Log in</h1>

        {successMessage && (
          <div role="status" style={successBannerStyle}>
            {successMessage}
          </div>
        )}

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        {/* This page had no labels at all, only placeholders -- which vanish the moment you
            start typing, and leave a screen reader announcing an unlabelled field. The
            placeholders stay alongside the new labels: RegisterPage already pairs the two,
            and several e2e specs reach these fields by getByPlaceholder. */}
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
            placeholder="Email"
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
            placeholder="Password"
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
    </main>
  );
}
