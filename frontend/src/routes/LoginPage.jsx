import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/shared/Spinner';
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
    <main
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

        {/* Was rendering on --color-pr-bg -- the personal-record celebration peach. A
            failure and an achievement must never share a colour. */}
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

// Shown between "the password was right" and "you are signed in", when one credential belongs to
// more than one household. Deliberately a plain list of buttons rather than a select: on a phone
// two or three big targets beat a dropdown, and the whole screen exists to be tapped once.
function HouseholdPicker({ households, onChoose, onCancel, submitting, error }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
      }}
    >
      <div
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
            alt="Huddle"
            style={{ width: 216, maxWidth: '100%', height: 'auto', marginBottom: 32 }}
          />
        </picture>

        <h1 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>Choose a household</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)' }}>
          You&rsquo;re part of more than one. You can switch later from the account menu.
        </p>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {households.map((household) => (
            <button
              key={household.accountId}
              type="button"
              disabled={submitting}
              onClick={() => onChoose(household.accountId)}
              className="btn btn-lg btn-full pressable"
              style={{
                background: 'var(--color-subtle-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                textAlign: 'left',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}
            >
              {/* .btn sets white-space: nowrap for ordinary short labels, which this composite
                  one isn't -- a long household name plus the role label together can exceed the
                  row's width. Flex items default to min-width: auto, so without overriding both,
                  the name refuses to shrink or wrap and pushes the role label past the button
                  (and on a narrow phone, past the card) instead of wrapping. */}
              <span style={{ fontWeight: 'var(--weight-semibold)', whiteSpace: 'normal', overflowWrap: 'anywhere', minWidth: 0, flex: '1 1 auto' }}>
                {household.accountName}
              </span>
              {/* Their own role, not a badge about the household -- it is the fastest way to tell
                  "the one I run" from "the one I was invited to" when both are named after a
                  family. */}
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textTransform: 'lowercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {household.accountRole === 'OWNER' ? 'you own this' : 'you\u2019re a member'}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onCancel}
          style={{
            marginTop: 'var(--space-5)',
            background: 'none',
            border: 'none',
            color: 'var(--color-muted)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
          }}
        >
          Use a different login
        </button>
      </div>
    </main>
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
