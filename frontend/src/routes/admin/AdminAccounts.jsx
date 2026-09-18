import { useCallback, useState } from 'react';
import { grantComp, listAccounts, revokeComp } from '../../api/admin';
import { useAdminData } from '../../hooks/useAdminData';
import { useUI } from '../../context/UIContext';
import { formatDate, formatDateTime } from '../../utils/datetime';
import AdminTable from '../../components/admin/AdminTable';
import Modal from '../../components/shared/Modal';
import Skeleton from '../../components/shared/Skeleton';
import { isPaidPlan } from '../../utils/planFeatures';

// The tiers an admin may grant. FREE is absent on purpose: removing a grant is its own action with
// its own audit event (COMP_REVOKED), and offering "grant Free" would be a second, unaudited route
// to the same end state. The server refuses it too -- this is just not offering what it would
// refuse.
//
// TEAM will appear here when BillingPlan gains it. Deliberately a literal list rather than
// something derived from planFeatures.js: a tier that exists in the enum is not automatically one
// we intend to hand out by hand, and the copy beside each name is not derivable anyway.
const GRANTABLE_PLANS = [
  { value: 'PLUS', label: 'Plus' },
  { value: 'PRO', label: 'Pro' },
];

// Mirrors the backend ClientBand enum. The client never sends a seat count -- it sends the band
// name and the server writes the real ceiling from band.clientLimit(). `seats` here is only used to
// read the CURRENT band back off a household, and must stay equal to clientLimit() for each band.
const CLIENT_BANDS = [
  { value: 'STARTER', label: 'Starter — 5 clients', seats: 5 },
  { value: 'STUDIO', label: 'Studio — 15 clients', seats: 15 },
  { value: 'PRACTICE', label: 'Practice — 40 clients', seats: 40 },
  { value: 'UNLIMITED', label: 'Unlimited', seats: null },
];

// Which band is this household on? Answered from `clientSeats`, the ceiling the grant wrote, since
// the band name itself is not stored (a band IS its ceiling -- ClientBand.clientLimit()).
//
// ⚠️ The form must open on the band a household ACTUALLY has. Defaulting to Starter meant an admin
// opening a Practice household to fix a typo in the note and pressing Update would quietly rewrite
// the band down to 5 clients -- harmless to the clients they already have (a band is a ceiling on
// adding, never a revocation) and therefore invisible until the next one was refused.
function currentBand(row) {
  if (row.plan !== 'PRO') return 'STARTER';
  const match = CLIENT_BANDS.find((b) => b.seats === row.clientSeats);
  return match ? match.value : 'UNLIMITED';
}

export default function AdminAccounts() {
  const fetchFn = useCallback(() => listAccounts(), []);
  const { data: accounts, loading, error, refetch } = useAdminData(fetchFn);
  const [editing, setEditing] = useState(null);

  const columns = buildColumns((account) => setEditing(account));

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={40} />
        ))}
      </div>
    );
  }

  if (error) {
    return <div style={{ color: 'var(--color-danger)', fontSize: 14 }}>{error}</div>;
  }

  return (
    <>
      <AdminTable columns={columns} rows={accounts} rowKey={(row) => row.id} emptyMessage="No households yet." />
      {editing ? (
        <CompModal
          account={editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await refetch();
          }}
        />
      ) : null}
    </>
  );
}

function buildColumns(onEdit) {
  return [
    { key: 'name', label: 'Household' },
    { key: 'primaryPersonName', label: 'Account holder' },
    { key: 'userEmail', label: 'Email' },
    {
      key: 'role',
      label: 'Role',
      render: (row) => (
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 6,
            background: row.role === 'ADMIN' ? 'var(--color-pr-bg)' : 'var(--color-subtle-bg)',
            color: row.role === 'ADMIN' ? 'var(--color-pr-text)' : 'var(--color-muted)',
          }}
        >
          {row.role}
        </span>
      ),
    },
    {
      // Both plan AND status, because they answer different questions: `plan` is the derived
      // entitlement (what this household can do), `subscriptionStatus` is Stripe's own view (why).
      // A household showing PLUS / PAST_DUE is mid-dunning and still entitled -- collapsing the two
      // would hide exactly the state worth noticing during support.
      key: 'plan',
      label: 'Plan',
      render: (row) => (
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 6,
            background: isPaidPlan(row.plan) ? 'var(--color-pr-bg)' : 'var(--color-subtle-bg)',
            color: isPaidPlan(row.plan) ? 'var(--color-pr-text)' : 'var(--color-muted)',
          }}
          title={compTooltip(row)}
        >
          {row.plan}
          {row.comped ? ' (comp)' : ''}
        </span>
      ),
    },
    {
      key: 'subscriptionStatus',
      label: 'Billing',
      render: (row) => {
        if (row.subscriptionStatus === 'FREE') return '—';
        const suffix = row.currentPeriodEnd
          ? ` ${row.cancelAtPeriodEnd ? 'ends' : 'renews'} ${formatDate(row.currentPeriodEnd)}`
          : '';
        return `${row.subscriptionStatus}${suffix}`;
      },
    },
    { key: 'peopleCount', label: 'People' },
    // A raw count, not a yes/no. Does this household use member logins is the question, but a
    // household of 5 people with 1 login and one with 4 are different support conversations, and a
    // flag flattens them.
    { key: 'loginCount', label: 'Logins' },
    { key: 'defaultUnit', label: 'Unit' },
    { key: 'sessionCount', label: 'Sessions' },
    { key: 'setCount', label: 'Sets' },
    { key: 'createdAt', label: 'Created', render: (row) => formatDateTime(row.createdAt) },
    { key: 'lastActivityAt', label: 'Last activity', render: (row) => formatDateTime(row.lastActivityAt) },
    {
      key: 'actions',
      label: 'Plan actions',
      // A control the server would refuse must not be offered (.claude/rules/member-access.md).
      // `compGrantable` is the SERVER's answer to "would a grant succeed here", not a rule
      // re-derived on the client -- so a household paying through Stripe gets a disabled button
      // that says why, rather than a doomed round trip turned into a toast.
      render: (row) => (
        <button
          type="button"
          onClick={() => onEdit(row)}
          disabled={!row.compGrantable && !row.comped}
          title={
            !row.compGrantable && !row.comped
              ? 'Paying through Stripe. Cancel that subscription in Stripe before granting a plan.'
              : undefined
          }
          style={actionButtonStyle}
        >
          Change plan
        </button>
      ),
    },
  ];
}

// Why this household is on the plan it is on, for the badge's hover. The comp note is the useful
// half; the Stripe customer id is what it always showed for a paying household.
function compTooltip(row) {
  if (!row.comped) return row.stripeCustomerId || '';
  return row.compNote
    ? `Comped — ${row.compNote}`
    : 'Comped — no Stripe subscription behind this';
}

// The grant form. A modal rather than a fourteenth inline column: the Accounts table is already
// very wide, and this is a deliberate, low-frequency action rather than an inline toggle.
//
// Not wrapped in OfflineDisabledWrap and not using useGatedMutation, unlike every write in the
// workout app. The admin portal sits outside that machinery by design -- it is an online-only
// observability tool on a hand-rolled fetch hook (useAdminData), with plain async handlers and a
// local busy flag, exactly like AlertSettingsPanel and TestDataCleanupButton beside it. Reaching
// for the app's durable/gated mechanisms here would be the second mechanism, not the right one.
function CompModal({ account, onClose, onDone }) {
  const { openConfirm, showToast } = useUI();
  const [plan, setPlan] = useState(account.comped && account.plan === 'PRO' ? 'PRO' : 'PLUS');
  const [band, setBand] = useState(() => currentBand(account));
  const [note, setNote] = useState(account.compNote || '');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const household = account.name || account.userEmail || `Household ${account.id}`;

  async function run(action, successMessage) {
    setBusy(true);
    setFormError('');
    try {
      await action();
      showToast(successMessage);
      await onDone();
    } catch (err) {
      // A gated write with no outbox behind it: if it fails, saying so is the only option left.
      // The server's message is the useful one here (it names the Stripe remedy for a 409, and
      // which field is wrong for a 400), and this is an admin screen, so there is no risk of
      // leaking developer copy to a household.
      setFormError(err?.message || 'That did not work. Try again.');
      setBusy(false);
    }
  }

  // No confirm dialog on the way in. The modal IS the deliberate step -- it was opened from a row,
  // a tier was chosen and a reason typed -- so a second "are you sure" over a form is friction
  // without information. Revoke keeps one, because that is the consequential direction.
  function handleGrant() {
    const label = GRANTABLE_PLANS.find((p) => p.value === plan)?.label ?? plan;
    run(
      () => grantComp(account.id, { plan, band: plan === 'PRO' ? band : null, note }),
      `${household} is on ${label}.`,
    );
  }

  function handleRevoke() {
    openConfirm(
      // Names the consequence before the admin acts, the same way the revoke-login confirm does.
      // Nothing is deleted and nothing is revoked: the pause is a status, and re-granting restores
      // every login with no re-invitation.
      `Remove ${household}'s free plan? Any member logins pause until they have a paid plan again. ` +
        'No workouts are deleted, and re-granting restores their logins.',
      () => run(() => revokeComp(account.id), `Removed ${household}'s free plan.`),
      // Not "Remove grant" -- that is the button in this modal that opened the dialog, and one
      // accessible name containing the other makes every getByRole on it ambiguous.
      { confirmLabel: 'Remove it' },
    );
  }

  return (
    <Modal onClose={onClose} title={`Plan for ${household}`} width={380}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label htmlFor="comp-plan" style={labelStyle}>
          Plan
          <select
            id="comp-plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            disabled={busy}
            style={fieldStyle}
          >
            {GRANTABLE_PLANS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {/* Only Pro has seats. Sending a band with a household tier is a 400, so the field is
            absent rather than disabled -- there is nothing to choose. */}
        {plan === 'PRO' ? (
          <label htmlFor="comp-band" style={labelStyle}>
            Client band
            <select
              id="comp-band"
              value={band}
              onChange={(e) => setBand(e.target.value)}
              disabled={busy}
              style={fieldStyle}
            >
              {CLIENT_BANDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label htmlFor="comp-note" style={labelStyle}>
          Reason (optional)
          <input
            id="comp-note"
            type="text"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="Founding household, beta tester…"
            style={fieldStyle}
          />
        </label>

        {formError ? <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>{formError}</div> : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {account.comped ? (
            <button type="button" onClick={handleRevoke} disabled={busy} style={dangerButtonStyle}>
              Remove grant
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleGrant}
            disabled={busy || !account.compGrantable}
            title={
              account.compGrantable
                ? undefined
                : 'Paying through Stripe. Cancel that subscription in Stripe before granting a plan.'
            }
            style={primaryButtonStyle}
          >
            {busy ? 'Saving…' : account.comped ? 'Update grant' : 'Grant plan'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-muted)',
};

const fieldStyle = {
  // 16px so iOS Safari does not zoom the viewport on focus -- the same reason every Input in the
  // app is --text-md.
  fontSize: 16,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
};

const actionButtonStyle = {
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--color-text)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const primaryButtonStyle = {
  background: 'var(--color-accent-strong)',
  border: '1px solid var(--color-accent-strong)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  color: '#fff',
  cursor: 'pointer',
};

const dangerButtonStyle = {
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-danger)',
  cursor: 'pointer',
};
