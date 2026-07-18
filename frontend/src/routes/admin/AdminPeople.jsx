import { useCallback } from 'react';
import { listPeople } from '../../api/admin';
import { useAdminData } from '../../hooks/useAdminData';
import { formatDateTime } from '../../utils/datetime';
import AdminTable from '../../components/admin/AdminTable';
import Skeleton from '../../components/shared/Skeleton';

const COLUMNS = [
  { key: 'name', label: 'Name' },
  {
    key: 'isPrimary',
    label: 'Primary',
    render: (row) => (row.isPrimary ? 'Yes' : ''),
  },
  { key: 'accountName', label: 'Household' },
  { key: 'userEmail', label: 'Login email' },
  { key: 'createdAt', label: 'Added', render: (row) => formatDateTime(row.createdAt) },
];

export default function AdminPeople() {
  const fetchFn = useCallback(() => listPeople(), []);
  const { data: people, loading, error } = useAdminData(fetchFn);

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

  return <AdminTable columns={COLUMNS} rows={people} rowKey={(row) => row.id} emptyMessage="No people yet." />;
}
