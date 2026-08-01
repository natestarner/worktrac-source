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
  { key: 'detail', label: 'Detail', render: (row) => row.detail || '—' },
  { key: 'ipAddress', label: 'IP', render: (row) => row.ipAddress || '—' },
  { key: 'messageId', label: 'Message ID', render: (row) => row.messageId || '—' },
];

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
