import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useOutboxCount } from '../../hooks/useOutboxCount';
import { formatDateTime } from '../../utils/datetime';

// Shown on read-only tabs (History/PRs/Trends/Routines) while offline, so a cached view is
// never mistaken for live data. The other half of the freshness story is `RefreshIndicator`, and
// the two can never show at once (this needs offline; that needs online + a background fetch).
//
// This one stays IN FLOW while the refresh indicator deliberately doesn't, and the difference is
// duration, not importance. A background refetch lasts a second or two, so an in-flow indicator
// spent its whole life shoving the page down and yanking it back. This notice stands for an entire
// outage: it is a sentence you are meant to stop and read, it must not sit on top of the data it
// is qualifying, and it appears in the same instant `OfflineBanner` pushes the whole app down
// anyway -- so reserving permanent empty space on four tabs would buy nothing.
//
// `updatedAt` is a query's `dataUpdatedAt` (ms epoch);
// `formatDateTime` accepts that directly, same as it does an ISO string, since `new Date(ms)`
// and `new Date(isoString)` both work.
//
// The timestamp alone understates the problem when writes are queued: none of these four tabs has
// an optimistic writer, and invalidation is a no-op while paused, so a set logged during the
// outage is *missing* from what's on screen rather than merely old. The count comes from the same
// useOutboxCount the banner reads, so the two can never disagree about how much is outstanding.
// Its wording deliberately shares no phrase with the banner's "N changes waiting to sync": both
// are on screen at once, and e2e/RTL each select the banner's count by its text.
export default function OfflineDataNotice({ updatedAt }) {
  const online = useOnlineStatus();
  const queued = useOutboxCount();
  if (online || !updatedAt) return null;

  // Curly apostrophe to match the banner's own copy ("They'll sync when you reconnect").
  const unsynced =
    queued === 0
      ? ''
      : queued === 1
        ? ' · 1 change hasn’t synced yet, so this is incomplete'
        : ` · ${queued} changes haven’t synced yet, so this is incomplete`;
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
      {/* One flat run of text nodes on purpose -- RTL's getByText only concatenates DIRECT text
          children, and four tab tests match this string with /Offline.*data as of/. */}
      Offline: data as of {formatDateTime(updatedAt)}
      {unsynced}
    </div>
  );
}
