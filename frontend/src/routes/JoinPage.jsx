import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/shared/Spinner';
import { errorBannerStyle, fieldLabelStyle } from './LoginPage';
import logoLight from '../assets/huddle-lockup-vertical-onlight.svg';
import logoDark from '../assets/huddle-lockup-vertical-ondark.svg';
import { FIELD_LIMITS } from '../utils/fieldLimits';

/**
 * Where an invite link lands: finish setting up a login and get signed straight in.
 *
 * <p>Mirrors ResetPasswordPage — same shape, same framing, and for the same reason: both are
 * "you followed a link from your email, now finish the thing".
 *
 * ⚠️ THE PASSWORD FIELD IS ALWAYS OFFERED, and that is deliberate. The server ignores it when the
 * invited address already has an account, and the client CANNOT know which case it is in — asking
 * would mean an endpoint that answers "does this address have an account", which is the exact
 * user-enumeration oracle the whole invite design avoids. So the page asks once, the server
 * decides, and somebody who already has an account simply has their entry ignored.
 */
export default function JoinPage() {
  const [params] = useSearchParams();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inviteId = params.get('i');
  const token = params.get('t');
  const linkIsIncomplete = !inviteId || !token;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // Mirrors RegisterPage's floor -- but a BLANK password is valid here (it means "use the
    // account I already have"), so only a non-empty, too-short entry is rejected. The server
    // enforces the same 8-char minimum on whatever it actually receives; this just gives someone
    // who typos a short password a field-level message instead of a round trip.
    const trimmedPassword = password.trim();
    if (trimmedPassword && trimmedPassword.length < 8) {
      setPasswordError(true);
      return;
    }

    setSubmitting(true);
    try {
      await acceptInvite({ inviteId, token, password: trimmedPassword || undefined });
      navigate('/app/log');
    } catch (err) {
      // The server says one thing for every way a link can fail — wrong, expired, already used,
      // locked out. Distinguishing them would tell whoever holds a bad link which part to keep
      // trying, and helps a legitimate recipient not at all: they can simply ask for another.
      setError(err.message || 'That invitation link is no longer valid. Ask for a new one.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <picture>
          <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
          <img src={logoLight} alt="Huddle" style={{ width: 216, maxWidth: '100%', height: 'auto', marginBottom: 32 }} />
        </picture>

        <h1 style={headingStyle}>Set up your login</h1>

        {linkIsIncomplete ? (
          // Missing halves of the link is not a server refusal, so it never reaches the API. Says
          // what to do rather than what is wrong with the URL.
          <div role="alert" style={errorBannerStyle}>
            This link is missing part of its address. Open the full link from your invitation email.
          </div>
        ) : (
          <>
            <p style={introStyle}>
              Choose a password to finish. If you already have a Huddle account with this address,
              leave it blank and we&rsquo;ll use the password you already have.
            </p>

            {error && (
              <div role="alert" style={errorBannerStyle}>
                {error}
              </div>
            )}

            <div style={{ textAlign: 'left', marginBottom: 'var(--space-4)' }}>
              <label htmlFor="password" style={fieldLabelStyle}>Password</label>
              <input
                type="password"
                id="password"
                name="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                maxLength={FIELD_LIMITS.password}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(false);
                }}
                aria-invalid={passwordError || undefined}
                aria-describedby={passwordError ? 'password-error' : undefined}
                className={`input ${passwordError ? 'input-invalid' : ''}`}
              />
              {passwordError && (
                <div id="password-error" style={fieldErrorStyle}>Password must be at least 8 characters.</div>
              )}
            </div>

            <button type="submit" disabled={submitting} className="btn btn-primary btn-lg btn-full pressable" style={{ position: 'relative' }}>
              <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Join household</span>
              {submitting && (
                <span style={spinnerWrapStyle}>
                  <Spinner color="currentColor" />
                </span>
              )}
            </button>
          </>
        )}
      </form>
    </main>
  );
}

const pageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--color-bg)',
};

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-xl)',
  padding: 'var(--space-10) var(--space-8)',
  width: 560,
  maxWidth: '92vw',
  textAlign: 'center',
  boxShadow: 'var(--shadow-2), var(--elevation-hairline)',
};

const headingStyle = {
  fontSize: 'var(--text-lg)',
  marginBottom: 'var(--space-2)',
};

const introStyle = {
  fontSize: 'var(--text-sm)',
  lineHeight: 1.55,
  color: 'var(--color-muted)',
  marginBottom: 'var(--space-5)',
};

const fieldErrorStyle = {
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-danger)',
  marginTop: 'var(--space-1)',
};

const spinnerWrapStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
