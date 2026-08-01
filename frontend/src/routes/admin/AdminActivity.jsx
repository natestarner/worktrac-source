import { useCallback, useMemo, useState } from 'react';
import {
  listRegistrationEvents,
  getRegistrationAlertSettings,
  updateRegistrationAlertSettings,
} from '../../api/admin';
import { useAdminData } from '../../hooks/useAdminData';
import { formatDateTime } from '../../utils/datetime';
import AdminTable from '../../components/admin/AdminTable';
import Skeleton from '../../components/shared/Skeleton';

// Event types that represent "things went as expected" -- everything else (wrong code,
// expired, locked, rate-limited, a send/delivery failure, a bounce, spam, ...) is treated as
// an issue for badge coloring and the "Only show issues" filter.
const POSITIVE_EVENT_TYPES = new Set([
  'REGISTER_STARTED',
  'RESEND_REQUESTED',
  'CONFIRM_SUCCESS',
  'VERIFICATION_EMAIL_SENT',
  'SUCCESS_EMAIL_SENT',
  'EMAIL_DELIVERED',
]);

function isIssue(eventType) {
  return !POSITIVE_EVENT_TYPES.has(eventType);
}

function EventBadge({ eventType }) {
  const issue = isIssue(eventType);
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
        background: issue ? 'var(--color-warning-bg)' : 'var(--color-success-bg)',
        color: issue ? 'var(--color-danger)' : 'var(--color-success)',
      }}
    >
      {eventType}
    </span>
  );
}

const COLUMNS = [
  { key: 'createdAt', label: 'Time', render: (row) => formatDateTime(row.createdAt) },
  { key: 'email', label: 'Email' },
  { key: 'eventType', label: 'Event', render: (row) => <EventBadge eventType={row.eventType} /> },
  {
    key: 'detail',
    label: 'Detail',
    wrap: true,
    // title gives a native tooltip with the untruncated text too, in case the wrapped column
    // still isn't wide enough for a very long SMTP diagnostic.
    render: (row) => (row.detail ? <span title={row.detail}>{row.detail}</span> : '—'),
  },
  { key: 'ipAddress', label: 'IP', render: (row) => row.ipAddress || '—' },
  { key: 'messageId', label: 'Message ID', render: (row) => row.messageId || '—' },
];

// Explains the two things that are easy to misread at a glance: what each event type actually
// means, and -- most importantly -- that a *_SENT event is not proof of delivery. Placed above
// the alert settings panel per admin feedback that the raw event-type strings alone weren't
// self-explanatory.
function ActivityLegend() {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        padding: '16px 20px',
        marginBottom: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700 }}>Legend</div>
      <div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 6,
            background: 'var(--color-success-bg)',
            color: 'var(--color-success)',
          }}
        >
          green
        </span>{' '}
        = expected step in a healthy registration.{' '}
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 6,
            background: 'var(--color-warning-bg)',
            color: 'var(--color-danger)',
          }}
        >
          red
        </span>{' '}
        = worth a look -- check the Detail column for the reason.
      </div>
      <div>
        <strong>Registration flow:</strong> REGISTER_STARTED / RESEND_REQUESTED / CONFIRM_SUCCESS
        are the happy path. REGISTER_DUPLICATE_EMAIL, REGISTER_RATE_LIMITED, RESEND_THROTTLED,
        RESEND_NOT_FOUND, and CONFIRM_WRONG_CODE / CONFIRM_EXPIRED / CONFIRM_LOCKED /
        CONFIRM_NOT_FOUND are the ways it can fail before an account is created.
      </div>
      <div>
        <strong>Email -- two different things, don't conflate them:</strong> *_EMAIL_SENT only
        means Azure Communication Services <em>accepted</em> the send request -- it is NOT proof
        the email reached anyone. *_EMAIL_FAILED means ACS rejected the send outright (detail has
        the real ACS error). EMAIL_DELIVERED / EMAIL_BOUNCED / EMAIL_FILTERED_SPAM /
        EMAIL_SUPPRESSED / EMAIL_QUARANTINED / EMAIL_DELIVERY_FAILED are the actual, true outcome,
        reported later by Event Grid -- this is the only way to know whether an email really
        arrived, and the detail column carries the recipient server's real diagnostic (e.g. the
        SMTP bounce reason).
      </div>
    </div>
  );
}

function AlertSettingsPanel() {
  const fetchFn = useCallback(() => getRegistrationAlertSettings(), []);
  const { data: settings, loading, error, refetch } = useAdminData(fetchFn);
  const [saving, setSaving] = useState(false);

  async function handleToggle(field, checked) {
    if (!settings) return;
    setSaving(true);
    try {
      await updateRegistrationAlertSettings({ ...settings, [field]: checked });
      await refetch();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton height={80} />;
  if (error) return <div style={{ color: 'var(--color-danger)', fontSize: 14 }}>{error}</div>;

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        padding: '16px 20px',
        marginBottom: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700 }}>Alert me by email when...</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <input
          type="checkbox"
          checked={settings.alertOnRegistrationConfirmed}
          disabled={saving}
          onChange={(e) => handleToggle('alertOnRegistrationConfirmed', e.target.checked)}
        />
        A new registration is confirmed
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <input
          type="checkbox"
          checked={settings.alertOnSendFailure}
          disabled={saving}
          onChange={(e) => handleToggle('alertOnSendFailure', e.target.checked)}
        />
        A verification or success email fails to send
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <input
          type="checkbox"
          checked={settings.alertOnDeliveryFailure}
          disabled={saving}
          onChange={(e) => handleToggle('alertOnDeliveryFailure', e.target.checked)}
        />
        An email bounces, is filtered as spam, or otherwise fails to deliver
      </label>
    </div>
  );
}

export default function AdminActivity() {
  const fetchFn = useCallback(() => listRegistrationEvents(), []);
  const { data: events, loading, error } = useAdminData(fetchFn);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const rows = useMemo(() => {
    if (!events) return [];
    return onlyIssues ? events.filter((e) => isIssue(e.eventType)) : events;
  }, [events, onlyIssues]);

  return (
    <div>
      <ActivityLegend />
      <AlertSettingsPanel />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 12 }}>
        <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
        Only show issues
      </label>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      ) : error ? (
        <div style={{ color: 'var(--color-danger)', fontSize: 14 }}>{error}</div>
      ) : (
        <AdminTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(row) => row.id}
          emptyMessage={onlyIssues ? 'No issues recorded.' : 'No registration activity yet.'}
        />
      )}
    </div>
  );
}
