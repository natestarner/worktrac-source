import { useCallback } from 'react';
import { getLibraryVideos } from '../../api/admin';
import { useAdminData } from '../../hooks/useAdminData';
import { formatDateTime } from '../../utils/datetime';
import { watchUrl } from '../../utils/exerciseVideo';
import AdminTable from '../../components/admin/AdminTable';
import Skeleton from '../../components/shared/Skeleton';

// The how-to video curation queue: every library exercise with no video to show, the ones people
// actually log first. Read-only, like the rest of the portal: a video is added by a reviewed CSV and
// a migration (docs/exercise-videos/README.md), never from here.
//
// Two reasons a row is here. "No video yet": none was found (most of these are Muscle & Strength
// clips on their site-locked Vimeo player). "Hidden": the daily check (ExerciseVideoChecker) found
// the YouTube video gone and stopped showing it -- the dead id is linked, so it can be confirmed and
// replaced.

function Reason({ row }) {
  if (row.reason !== 'unavailable') {
    return <span style={{ color: 'var(--color-muted)' }}>No video yet</span>;
  }
  return (
    <span>
      <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>Hidden</span>
      {' '}— gone from YouTube
      {row.checkedAt ? `, checked ${formatDateTime(row.checkedAt)}` : ''} (
      <a href={watchUrl({ videoId: row.videoId })} target="_blank" rel="noopener noreferrer">
        {row.videoId}
      </a>
      )
    </span>
  );
}

const COLUMNS = [
  { key: 'name', label: 'Exercise' },
  { key: 'reason', label: 'Why', render: (row) => <Reason row={row} /> },
  { key: 'peopleUsing', label: 'People using it' },
];

export default function AdminVideos() {
  const fetchFn = useCallback(() => getLibraryVideos(), []);
  const { data, loading, error } = useAdminData(fetchFn);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--color-muted)' }}>
        {data.withVideoCount} of {data.libraryCount} library exercises have a how-to video.{' '}
        {data.missing.length} don&rsquo;t, most-used first.
      </p>
      <AdminTable
        columns={COLUMNS}
        rows={data.missing}
        rowKey={(row) => row.exerciseId}
        emptyMessage="Every library exercise has a video."
      />
    </div>
  );
}
