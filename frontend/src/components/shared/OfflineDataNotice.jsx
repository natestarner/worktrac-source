import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { formatDateTime } from '../../utils/datetime';

// Shown on read-only tabs (History/PRs/Trends/Routines) while offline, so a cached view is
// never mistaken for live data. Mirrors RefreshingPill's visual language -- the two occupy the
// same "freshness" slot in each tab's top area and never show at once (this needs offline; that
// needs online + a background fetch). `updatedAt` is a query's `dataUpdatedAt` (ms epoch);
// `formatDateTime` accepts that directly, same as it does an ISO string, since `new Date(ms)`
// and `new Date(isoString)` both work.
export default function OfflineDataNotice({ updatedAt }) {
  const online = useOnlineStatus();
  if (online || !updatedAt) return null;
  return (
    <div
      role="status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        padding: '4px 10px',
        marginBottom: 12,
        borderRadius: 999,
        background: 'var(--color-subtle-bg)',
        color: 'var(--color-muted)',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      Offline &mdash; data as of {formatDateTime(updatedAt)}
    </div>
  );
}
