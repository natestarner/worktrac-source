import { useCallback } from 'react';
import { getOverview } from '../../api/admin';
import { useAdminData } from '../../hooks/useAdminData';
import Skeleton from '../../components/shared/Skeleton';

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '16px 18px',
};

const labelStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 8,
};

export default function AdminOverview() {
  const fetchFn = useCallback(() => getOverview(), []);
  const { data: overview, loading, error } = useAdminData(fetchFn);

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={cardStyle}>
            <Skeleton width={100} height={12} style={{ marginBottom: 10 }} />
            <Skeleton width={60} height={22} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <div style={{ color: 'var(--color-danger)', fontSize: 14 }}>{error}</div>;
  }

  const tiles = [
    { label: 'Households', value: overview.totalAccounts },
    { label: 'Users', value: overview.totalUsers },
    { label: 'People tracked', value: overview.totalPeople },
    { label: 'Workout sessions', value: overview.totalSessions },
    { label: 'Sets logged', value: overview.totalSets },
    { label: 'Pending registrations', value: overview.pendingRegistrations },
    { label: 'Signups · last 7 days', value: overview.signupsLast7Days },
    { label: 'Signups · last 30 days', value: overview.signupsLast30Days },
    { label: 'Active households · 7 days', value: overview.activeAccountsLast7Days },
    { label: 'Active households · 30 days', value: overview.activeAccountsLast30Days },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      {tiles.map((tile) => (
        <div key={tile.label} style={cardStyle}>
          <div style={labelStyle}>{tile.label}</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{tile.value}</div>
        </div>
      ))}
    </div>
  );
}
