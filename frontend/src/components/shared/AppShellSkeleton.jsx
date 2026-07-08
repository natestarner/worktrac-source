import Header from '../layout/Header';
import TabsNav from '../layout/TabsNav';
import Skeleton from './Skeleton';

// Shown while the initial /api/auth/me call is in flight, before we know whether the
// user is authenticated. Header and TabsNav are pure chrome with no data dependency, so
// they're rendered for real (guaranteed to match pixel-for-pixel); only the person-pill
// row and the Log tab's default content -- both of which depend on data we don't have
// yet -- are faked, sized to match PersonPillBar/ExercisePicker's real CSS.
export default function AppShellSkeleton() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <Header />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 24px',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Skeleton width={120} height={42} radius={999} />
        <Skeleton width={100} height={42} radius={999} />
        <Skeleton width={128} height={37} radius={999} />
      </div>

      <TabsNav />

      <div style={{ maxWidth: 840, margin: '0 auto', padding: '0 24px' }}>
        <Skeleton width="100%" height={46} radius={14} style={{ marginBottom: 18 }} />
        <Skeleton width={90} height={12} style={{ marginBottom: 10 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
          <Skeleton width={110} height={46} radius={14} />
          <Skeleton width={140} height={46} radius={14} />
          <Skeleton width={96} height={46} radius={14} />
        </div>
        <Skeleton width={120} height={12} style={{ marginBottom: 10 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Skeleton width={128} height={46} radius={14} />
          <Skeleton width={104} height={46} radius={14} />
          <Skeleton width={150} height={46} radius={14} />
          <Skeleton width={90} height={46} radius={14} />
        </div>
      </div>
    </div>
  );
}
