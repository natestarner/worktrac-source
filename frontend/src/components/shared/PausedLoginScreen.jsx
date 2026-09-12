import { useAuth } from '../../context/AuthContext';
import { useAccountAccess } from '../../hooks/useAccountAccess';

/**
 * What a member sees when their household is no longer on Plus.
 *
 * ⚠️ <b>This replaces the app rather than disabling parts of it, and that is the whole point.</b>
 * A paused login is refused on every route, so leaving the normal screens up would render an app
 * whose every control fails — the "app appears broken before it appears restricted" problem that
 * `ReadOnlyPersonNotice` exists to avoid, except total. One screen that states the situation is
 * both kinder and cheaper: the client attempts no request it knows will be refused.
 *
 * ⚠️ <b>Nothing here is a paywall pitch.</b> The person reading it cannot fix it — only the
 * household owner can — so an "Upgrade" button would be a control that 403s
 * (`MANAGE_BILLING` is owner-only). It says who to ask instead. `ownerName` is what makes that
 * sentence possible, and it is null-safe: an unresolved owner reads as "the household owner".
 *
 * ⚠️ <b>The reassurance is not decoration.</b> "Nothing has been deleted" is the single most
 * important sentence on the screen, because the honest fear on seeing this is that a lapsed
 * payment cost somebody their training history. It did not, and `billing.md`'s promise that
 * workouts are never deleted on Free still holds exactly.
 */
export default function PausedLoginScreen() {
  const { user, logout } = useAuth();
  const { ownerName } = useAccountAccess();
  const owner = ownerName || 'The household owner';

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={markStyle} aria-hidden="true">
          &#9208;
        </div>
        <h1 style={titleStyle}>Your login is paused</h1>

        <p style={bodyStyle}>
          Personal logins are part of Huddle Plus, and this household isn&rsquo;t on Plus right now.
        </p>

        {/* The sentence people actually need. Stated plainly and early, not buried under the
            explanation of what happened. */}
        <p style={reassureStyle}>
          <strong>Nothing has been deleted.</strong> Your workouts, your history and your PRs are
          all exactly where you left them, and they&rsquo;ll be here when you get back.
        </p>

        <p style={bodyStyle}>
          {owner} can turn Plus back on, and your login will start working again straight away
          &mdash; you won&rsquo;t need a new invitation.
        </p>

        {/* No Upgrade button: managing the plan is owner-only, so it could only ever 403.
            Sign out IS offered, and it is the only control here that must be: without it this
            screen is a dead end for somebody who has another household to switch to, or who is
            simply on the wrong login. Switching households is not offered instead -- that needs
            the account menu, which this screen replaces, and the pause is per-household anyway. */}
        <div style={footStyle}>
          Signed in as {user?.email}
          {' \u00b7 '}
          <button onClick={logout} style={signOutStyle}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

const wrapStyle = {
  minHeight: '100vh',
  background: 'var(--color-bg)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-5)',
};

const cardStyle = {
  width: '100%',
  maxWidth: 440,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-6)',
  textAlign: 'center',
};

const markStyle = { fontSize: 40, lineHeight: 1, marginBottom: 'var(--space-4)' };

const titleStyle = {
  margin: '0 0 var(--space-4)',
  fontSize: 'var(--text-xl)',
  fontWeight: 700,
};

const bodyStyle = {
  margin: '0 0 var(--space-4)',
  fontSize: 15,
  lineHeight: 1.6,
  color: 'var(--color-muted)',
};

const reassureStyle = {
  margin: '0 0 var(--space-4)',
  padding: 'var(--space-4)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)',
  fontSize: 15,
  lineHeight: 1.6,
};

const signOutStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--color-accent-text)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const footStyle = {
  marginTop: 'var(--space-5)',
  fontSize: 13,
  color: 'var(--color-muted)',
};
