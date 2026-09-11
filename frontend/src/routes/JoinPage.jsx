import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isOfflineError } from '../api/client';
import Spinner from '../components/shared/Spinner';
import HouseholdPicker from '../components/auth/HouseholdPicker';
import { authCardStyle, authPageStyle, errorBannerStyle, fieldLabelStyle } from '../components/auth/authStyles';
import logoLight from '../assets/huddle-lockup-vertical-onlight.svg';
import logoDark from '../assets/huddle-lockup-vertical-ondark.svg';
import { FIELD_LIMITS } from '../utils/fieldLimits';

/**
 * Where an invite link lands.
 *
 * ⚠️ THE SCREEN ASKS THE RIGHT QUESTION, which it previously could not. It used to offer a
 * password field to everybody and tell the reader to leave it blank if they already had a Huddle
 * account — asking somebody to understand an implementation detail about themselves, and saying
 * the opposite of the invitation email, which tells that same reader to sign in with the password
 * they already have. `POST /api/auth/invite/preview` answers which case this is, gated by the
 * emailed token; see MembershipInviteService.preview for why that is not the user-enumeration
 * oracle the invite design forbids.
 *
 * Four states, and the last two exist because a signed-in visitor was not handled at all:
 *
 *   SET_PASSWORD                  a new address, choosing a password. Unchanged.
 *   SIGN_IN, signed out           an existing address, PROVING the password it already has.
 *   SIGN_IN, signed in as them    their session is the proof; no password field at all.
 *   SIGN_IN, signed in as someone else
 *                                 named plainly, with both doors offered. This route silently
 *                                 swapped the signed-in identity before, on a shared iPad, with no
 *                                 confirmation.
 *
 * On success this renders the SHARED HouseholdPicker whenever the response carries no token —
 * exactly what LoginPage does with the same `{ households, selectionToken }`. Somebody who already
 * had a household now has two, so that picker is the screen they would have met on their very next
 * sign-in anyway. Reusing it is the whole reason joining needs no journey of its own.
 */
export default function JoinPage() {
  const [params] = useSearchParams();
  const { acceptInvite, previewInvite, chooseHousehold, logout, user, status } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // What the invitation wants: null while loading, or { mode, householdName, personName, email }.
  const [invitation, setInvitation] = useState(null);
  // Set only when accepting left this credential in two or more households. Holds the five-minute
  // selection token, in COMPONENT STATE for the reason LoginPage spells out: it is a credential,
  // and it should exist for exactly as long as the picker is on screen.
  const [choice, setChoice] = useState(null);

  const inviteId = params.get('i');
  const token = params.get('t');
  const linkIsIncomplete = !inviteId || !token;

  // Signing in is the only thing that can change who we are mid-flow, and `status` settles before
  // the invitee could act on it. Compared case-insensitively because the server normalises the
  // invited address to lower case and a session's email is whatever was typed at registration.
  const signedInEmail = status === 'authenticated' ? (user?.email ?? null) : null;
  const invitationIsForMe =
    signedInEmail != null
    && invitation?.email != null
    && signedInEmail.toLowerCase() === invitation.email.toLowerCase();

  useEffect(() => {
    if (linkIsIncomplete) return undefined;
    let cancelled = false;
    setError('');
    previewInvite({ inviteId, token })
      .then((preview) => {
        if (!cancelled) setInvitation(preview);
      })
      .catch((err) => {
        if (cancelled) return;
        // ⚠️ A link we could not CHECK is not a link we know to be bad. Saying "no longer valid"
        // for a cold start or a dead connection tells somebody holding a perfectly good invitation
        // to go ask for another one -- and lower's measured ~35s cold start against a 45s bound
        // makes that a routine occurrence, not an edge case.
        setError(isOfflineError(err)
          ? 'Couldn’t reach Huddle to check this invitation. Check your connection and try again.'
          : (err.message || 'That invitation link is no longer valid. Ask for a new one.'));
      });
    return () => { cancelled = true; };
  }, [inviteId, token, linkIsIncomplete, previewInvite]);

  async function submit(withPassword) {
    setError('');
    setSubmitting(true);
    try {
      const needsChoice = await acceptInvite({ inviteId, token, password: withPassword });
      if (needsChoice) {
        setChoice(needsChoice);
        return;
      }
      navigate('/app/log');
    } catch (err) {
      setError(err.message || 'That invitation link is no longer valid. Ask for a new one.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();

    const trimmedPassword = password.trim();
    // The server enforces the same 8-character floor on whatever it receives; this just saves a
    // round trip for an obvious typo. It applies to BOTH modes now: setting a password and proving
    // one. No password this app has ever issued is shorter than 8 characters, so a short entry
    // cannot be a real credential either way.
    if (trimmedPassword.length < 8) {
      setPasswordError(true);
      return;
    }
    submit(trimmedPassword);
  }

  async function handleChoose(accountId) {
    setError('');
    setSubmitting(true);
    try {
      await chooseHousehold(accountId, choice.selectionToken);
      navigate('/app/log');
    } catch (err) {
      // Almost always an expired selection token -- five minutes is short on purpose. The
      // membership is already attached, so there is nothing to redo: signing in reaches it.
      setError(err.message || 'That took too long — sign in again to pick a household.');
      setChoice(null);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Joined. Which household now? The same picker a multi-household login lands on. ──────────
  if (choice) {
    return (
      <HouseholdPicker
        households={choice.households}
        onChoose={handleChoose}
        submitting={submitting}
        error={error}
        heading="You’re in — choose a household"
        intro="You’re part of more than one now. You can switch between them any time from the account menu."
      />
    );
  }

  const mode = invitation?.mode;
  const householdName = invitation?.householdName;

  return (
    <main style={authPageStyle}>
      <form onSubmit={handleSubmit} style={authCardStyle}>
        <picture>
          <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
          <img src={logoLight} alt="Huddle" style={{ width: 216, maxWidth: '100%', height: 'auto', marginBottom: 32 }} />
        </picture>

        <h1 style={headingStyle}>
          {householdName ? `Join ${householdName}` : 'Join a household'}
        </h1>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        {linkIsIncomplete ? (
          // Missing halves of the link is not a server refusal, so it never reaches the API. Says
          // what to do rather than what is wrong with the URL.
          <div role="alert" style={errorBannerStyle}>
            This link is missing part of its address. Open the full link from your invitation email.
          </div>
        ) : !invitation ? (
          // Nothing to ask until we know which question this is. The error above stands on its own
          // when the check itself failed.
          !error && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-6)' }}>
              <Spinner />
            </div>
          )
        ) : signedInEmail && !invitationIsForMe ? (
          // ⚠️ NEVER SILENTLY SWAP IDENTITY. Accepting used to replace the signed-in session
          // wholesale, so opening Sam's link on Nate's iPad signed Nate out and Sam in with no
          // confirmation and nothing on screen to explain it.
          <>
            <p style={introStyle}>
              This invitation is for <strong>{invitation.email}</strong>, but you’re signed in as{' '}
              <strong>{signedInEmail}</strong>.
            </p>
            <button
              type="button"
              onClick={() => logout()}
              className="btn btn-primary btn-lg btn-full pressable"
              title={`Sign in as ${invitation.email}`}
            >
              <span style={buttonLabelStyle}>Sign in as {invitation.email}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/log')}
              className="btn btn-lg btn-full pressable"
              style={{ marginTop: 'var(--space-3)', background: 'var(--color-subtle-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              title={`Stay signed in as ${signedInEmail}`}
            >
              <span style={buttonLabelStyle}>Stay signed in as {signedInEmail}</span>
            </button>
            <p style={{ ...introStyle, marginTop: 'var(--space-5)', marginBottom: 0 }}>
              The invitation stays valid either way.
            </p>
          </>
        ) : invitationIsForMe ? (
          // Their own session is the proof, and a stronger one than a password: it reached the
          // server's security context only after its signature, scope and token version all
          // checked out. So there is nothing to type.
          <>
            <p style={introStyle}>
              You’re signed in as <strong>{signedInEmail}</strong>. Joining adds {householdName} to
              your account — the household you’re in now stays exactly as it is.
            </p>
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit(undefined)}
              className="btn btn-primary btn-lg btn-full pressable"
              style={{ position: 'relative' }}
            >
              <span style={{ visibility: submitting ? 'hidden' : 'visible' }}>Join household</span>
              {submitting && (
                <span style={spinnerWrapStyle}>
                  <Spinner color="currentColor" />
                </span>
              )}
            </button>
          </>
        ) : (
          <>
            <p style={introStyle}>
              {mode === 'SIGN_IN'
                ? `You already have a Huddle account. Sign in and ${householdName} is added to it — anything you already track stays exactly where it is.`
                : `${invitation.personName}, choose a password to finish setting up your login.`}
            </p>

            {/* Read-only, and shown for both modes: it tells the reader WHICH address was invited,
                which is the difference between "this is mine" and "this went to the wrong person".
                Not an input they can change -- the invitation names one address and only that
                address can accept it. */}
            <div style={{ textAlign: 'left', marginBottom: 'var(--space-4)' }}>
              <label htmlFor="join-email" style={fieldLabelStyle}>Email</label>
              <input
                type="email"
                id="join-email"
                name="email"
                autoComplete="username"
                readOnly
                value={invitation.email}
                className="input"
                style={{ color: 'var(--color-muted)' }}
              />
            </div>

            <div style={{ textAlign: 'left', marginBottom: 'var(--space-4)' }}>
              <label htmlFor="password" style={fieldLabelStyle}>Password</label>
              <input
                type="password"
                id="password"
                name="password"
                // current-password when proving one, new-password when setting one: this is what
                // decides whether a password manager offers to fill or to save.
                autoComplete={mode === 'SIGN_IN' ? 'current-password' : 'new-password'}
                placeholder={mode === 'SIGN_IN' ? 'Your Huddle password' : 'At least 8 characters'}
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

            {mode === 'SIGN_IN' && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Link to="/forgot-password" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
                  Forgot your password?
                </Link>
              </div>
            )}
          </>
        )}
      </form>
    </main>
  );
}

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

// Sign-in-as/stay-signed-in-as buttons embed an arbitrary-length email straight into the label.
// .btn is display:inline-flex + white-space:nowrap with no overflow handling of its own, and a
// bare text child can't be targeted with text-overflow -- it needs a real element so the browser
// has something to shrink and ellipsize. overflow:hidden here also resolves this span's automatic
// flex min-width to 0, which is what lets it shrink below the email's full width instead of
// pushing the button (and the text bleeding out of it) past the card's edge. Same pattern as
// LoginsSection.jsx's emailStyle. The full address is still the button's accessible name and its
// `title`, so nothing is lost -- only the on-screen line is shortened.
const buttonLabelStyle = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
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
