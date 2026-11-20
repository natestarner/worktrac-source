import { useAuth } from '../../context/AuthContext';
import { useAccountAccess } from '../../hooks/useAccountAccess';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useHouseholdSwitch, unsyncedSwitchMessage } from '../../hooks/useHouseholdSwitch';
import { downloadPersonCsv } from '../../api/export';
import { accountVocab } from '../../utils/accountVocab';
import Button from './Button';
import OfflineDisabledWrap from './OfflineDisabledWrap';
import { IconDownload } from './icons';

/**
 * What a member sees when their account is no longer on a paid plan.
 *
 * ⚠️ <b>It names no tier, and that is deliberate rather than vague.</b> By the time this screen
 * renders, the account HAS lapsed -- so `account.plan` is FREE and the tier they were actually on
 * is not knowable from here. It said "part of Huddle Plus" and "{owner} can turn Plus back on",
 * which was simply false for a trainer's client whose PRO subscription lapsed: they were never on
 * Plus. Naming the paid plans generally is true on every tier, including Team.
 *
 * The NOUN still moves with the tier via AccountVocab -- and note it will already have fallen back
 * to the family nouns here for the same reason, since vocab is derived from the (now Free) plan.
 * That is the safe direction: "household" reads as slightly generic to a client, where "practice"
 * on a family account would read as plainly wrong.
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
 *
 * <b>Two ways forward that do not depend on the owner</b> (added 2026-11-20, after a real member
 * with a second household could only reach it by signing out):
 * - <b>Download my workouts</b> — their OWN profile's CSV, the same export History offers. The
 *   server lets a paused login make exactly this one extra request (`PermissionInterceptor
 *   #isAllowedWhilePaused`), because export is free on every tier and someone locked out through no
 *   fault of their own is who needs it most. Hidden when the membership has no profile: there is
 *   nothing to export, and the server would refuse it.
 * - <b>Switch to {household}</b>, one per OTHER household this login belongs to, through
 *   `useHouseholdSwitch` — the account menu's exact mechanism, since the menu is not on screen
 *   here. The pause is per-household, so the other household is unaffected by it.
 */
export default function PausedLoginScreen() {
  const { user, account, logout } = useAuth();
  const { ownerName, selfPersonId } = useAccountAccess();
  const vocab = accountVocab(account?.vocab);
  const owner = ownerName || `The ${vocab.owner}`;
  const { otherAccounts, switching, pendingSwitch, requestSwitch, confirmSwitch, cancelSwitch } =
    useHouseholdSwitch();
  // Export is a gated (online-only) action like everywhere else it appears: no queue behind it, so a
  // failure has to be said out loud (the toast AppShell renders beside this screen).
  const { pending: downloading, run } = useGatedMutation({
    offlineMessage: 'Downloading needs a connection.',
    errorMessage: "Couldn't download your workouts. Try again.",
  });
  const download = run(() => downloadPersonCsv(selfPersonId));

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={markStyle} aria-hidden="true">
          &#9208;
        </div>
        <h1 style={titleStyle}>Your login is paused</h1>

        <p style={bodyStyle}>
          Personal logins are part of Huddle&rsquo;s paid plans, and this {vocab.account}{' '}
          isn&rsquo;t on one right now.
        </p>

        {/* The sentence people actually need. Stated plainly and early, not buried under the
            explanation of what happened. */}
        <p style={reassureStyle}>
          <strong>Nothing has been deleted.</strong> Your workouts, your history and your PRs are
          all exactly where you left them, and they&rsquo;ll be here when you get back.
        </p>

        <p style={bodyStyle}>
          {owner} can turn it back on, and your login will start working again straight away
          &mdash; you won&rsquo;t need a new invitation.
        </p>

        {/* What the reader CAN do without the owner. No Upgrade button: managing the plan is
            owner-only, so it could only ever 403 (member-access.md, "a control the server will
            refuse must not be offered"). */}
        <div style={actionsStyle}>
          {selfPersonId != null && (
            <OfflineDisabledWrap message="Downloading needs a connection.">
              <Button onClick={download} disabled={downloading} variant="primary" fullWidth>
                <IconDownload size={16} />
                Download my workouts
              </Button>
            </OfflineDisabledWrap>
          )}

          {otherAccounts.map((other) => (
            <Button
              key={other.accountId}
              onClick={() => requestSwitch(other)}
              disabled={switching}
              variant="secondary"
              fullWidth
            >
              {`Switch to ${other.accountName}`}
            </Button>
          ))}

          {pendingSwitch && (
            <div role="alertdialog" aria-label="Unsynced changes" style={confirmStyle}>
              <p style={{ margin: '0 0 var(--space-3)' }}>{unsyncedSwitchMessage(pendingSwitch.count)}</p>
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
                <Button onClick={confirmSwitch} size="sm" variant="secondary">
                  Switch anyway
                </Button>
                <Button onClick={cancelSwitch} size="sm" variant="secondary">
                  Stay here
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Sign out stays, and is the one control that must always be here: the wrong login, or a
            household this login can only reach through the household picker, both need it. */}
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
  minHeight: 'var(--viewport-min-height)',
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

const actionsStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  marginTop: 'var(--space-5)',
};

const confirmStyle = {
  padding: 'var(--space-4)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)',
  fontSize: 'var(--text-sm)',
  lineHeight: 1.5,
};

const footStyle = {
  marginTop: 'var(--space-5)',
  fontSize: 13,
  color: 'var(--color-muted)',
};
