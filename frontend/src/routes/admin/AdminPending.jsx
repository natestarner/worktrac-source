import { useCallback } from 'react';
import { listPendingRegistrations } from '../../api/admin';
import { useAdminData } from '../../hooks/useAdminData';
import { formatDateTime } from '../../utils/datetime';
import AdminTable from '../../components/admin/AdminTable';
import Skeleton from '../../components/shared/Skeleton';

// Whether this last-known status is a good outcome (green) or a problem worth noticing (red) --
// UNKNOWN is neutral: no send/delivery event has been recorded for this email yet, which is
// normal in the brief window right after register() returns.
const GOOD_EMAIL_STATUSES = new Set(['SENT', 'DELIVERED']);

function EmailStatusBadge({ status }) {
  const good = GOOD_EMAIL_STATUSES.has(status);
  const neutral = status === 'UNKNOWN';
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
        background: neutral ? 'var(--color-subtle-bg)' : good ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
        color: neutral ? 'var(--color-muted)' : good ? 'var(--color-success)' : 'var(--color-danger)',
      }}
    >
      {status}
    </span>
  );
}

const COLUMNS = [
  { key: 'email', label: 'Email' },
  { key: 'personName', label: 'Person' },
  { key: 'accountName', label: 'Household' },
  { key: 'attemptCount', label: 'Attempts' },
  { key: 'resendCount', label: 'Resends' },
  { key: 'lastEmailStatus', label: 'Email status', render: (row) => <EmailStatusBadge status={row.lastEmailStatus} /> },
  { key: 'createdAt', label: 'Started', render: (row) => formatDateTime(row.createdAt) },
  {
    key: 'expiresAt',
    label: 'Expires',
    render: (row) => (
      <span style={row.expired ? { color: 'var(--color-danger)', fontWeight: 700 } : undefined}>
        {formatDateTime(row.expiresAt)}
        {row.expired ? ' (expired)' : ''}
      </span>
    ),
  },
];

export default function AdminPending() {
  const fetchFn = useCallback(() => listPendingRegistrations(), []);
  const { data: pending, loading, error } = useAdminData(fetchFn);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={40} />
        ))}
      </div>
    );
  }

  if (error) {
    return <div style={{ color: 'var(--color-danger)', fontSize: 14 }}>{error}</div>;
  }

  return (
    <AdminTable
      columns={COLUMNS}
      rows={pending}
      rowKey={(row) => row.id}
      emptyMessage="No outstanding unconfirmed registrations."
    />
  );
}
