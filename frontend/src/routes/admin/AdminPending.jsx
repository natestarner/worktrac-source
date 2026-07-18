import { useCallback } from 'react';
import { listPendingRegistrations } from '../../api/admin';
import { useAdminData } from '../../hooks/useAdminData';
import { formatDateTime } from '../../utils/datetime';
import AdminTable from '../../components/admin/AdminTable';
import Skeleton from '../../components/shared/Skeleton';

const COLUMNS = [
  { key: 'email', label: 'Email' },
  { key: 'personName', label: 'Person' },
  { key: 'accountName', label: 'Household' },
  { key: 'attemptCount', label: 'Attempts' },
  { key: 'resendCount', label: 'Resends' },
  { key: 'createdAt', label: 'Started', render: (row) => formatDateTime(row.createdAt) },
  { key: 'expiresAt', label: 'Expires', render: (row) => formatDateTime(row.expiresAt) },
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
