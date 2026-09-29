import { useMemo } from 'react';
import { VIEWER_ZONE, useStatsFromHistory } from './useStatsFromHistory';
import { exerciseTrend } from '../utils/statsFromHistory';

// One exercise's points over the range, derived from the History this device holds -- the same
// points GET /trends/exercises/{id} returns. On Free a dot's record flag is judged against the
// window the device holds (docs/architecture/prs-trends-from-history.md, "Decisions").
export function useExerciseTrend(personId, exerciseId, weeks) {
  const stats = useStatsFromHistory(personId);
  const windowStart = stats.historyWindow?.windowStart ?? null;
  const day = new Date().toDateString();
  const points = useMemo(
    () =>
      stats.status === 'ready' && exerciseId
        ? exerciseTrend(stats.digests, exerciseId, { weeks, zone: VIEWER_ZONE, now: Date.now(), windowStart })
        : [],
    // `day` stands in for Date.now(): the range only moves with the calendar date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats.status, stats.digests, exerciseId, weeks, windowStart, day],
  );
  return { points, loading: stats.status === 'loading', isFetching: stats.isFetching, refetch: stats.refetch };
}
