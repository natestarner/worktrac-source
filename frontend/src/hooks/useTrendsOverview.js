import { useMemo } from 'react';
import { VIEWER_ZONE, useStatsFromHistory } from './useStatsFromHistory';
import { trendsOverview } from '../utils/statsFromHistory';

// The Trends overview, derived from the History this device holds (useStatsFromHistory) -- the same
// answer GET /trends/overview gives, in the viewer's zone. Recomputed per range and per calendar
// day (today, the current week and the 30-day windows move at midnight), never fetched.
//
// `overview` is null until History is on this device. isPaused / isError are History's, so a device
// that has never held it, offline, is told so rather than shown a skeleton forever (TrendsTab).
export function useTrendsOverview(personId, weeks) {
  const stats = useStatsFromHistory(personId);
  const hiddenSessions = stats.historyWindow?.hiddenSessions ?? 0;
  const day = new Date().toDateString();
  const overview = useMemo(
    () =>
      stats.status === 'ready'
        ? trendsOverview(stats.digests, { weeks, zone: VIEWER_ZONE, now: Date.now(), hiddenSessions })
        : null,
    // `day` stands in for Date.now(): the overview only changes with the calendar date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats.status, stats.digests, weeks, hiddenSessions, day],
  );
  return {
    overview,
    loading: stats.status === 'loading',
    isFetching: stats.isFetching,
    isPaused: stats.isPaused,
    isError: stats.isError,
    updatedAt: stats.updatedAt,
    refetch: stats.refetch,
  };
}
