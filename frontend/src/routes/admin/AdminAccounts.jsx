import { useCallback } from 'react';
import { listAccounts } from '../../api/admin';
import { useAdminData } from '../../hooks/useAdminData';
import { formatDate, formatDateTime } from '../../utils/datetime';
import AdminTable from '../../components/admin/AdminTable';
import Skeleton from '../../components/shared/Skeleton';

const COLUMNS = [
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
    // A household showing PRO / PAST_DUE is mid-dunning and still entitled -- collapsing the two
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
          background: row.plan === 'PRO' ? 'var(--color-pr-bg)' : 'var(--color-subtle-bg)',
          color: row.plan === 'PRO' ? 'var(--color-pr-text)' : 'var(--color-muted)',
        }}
        title={row.comped ? 'Comped -- no Stripe subscription behind this' : row.stripeCustomerId || ''}
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
  { key: 'defaultUnit', label: 'Unit' },
  { key: 'sessionCount', label: 'Sessions' },
  { key: 'setCount', label: 'Sets' },
  { key: 'createdAt', label: 'Created', render: (row) => formatDateTime(row.createdAt) },
  { key: 'lastActivityAt', label: 'Last activity', render: (row) => formatDateTime(row.lastActivityAt) },
];

export default function AdminAccounts() {
  const fetchFn = useCallback(() => listAccounts(), []);
  const { data: accounts, loading, error } = useAdminData(fetchFn);

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

  return <AdminTable columns={COLUMNS} rows={accounts} rowKey={(row) => row.id} emptyMessage="No households yet." />;
}
