import { useMemo } from 'react';
import { VIEWER_ZONE, useStatsFromHistory } from './useStatsFromHistory';
import { exerciseRecords } from '../utils/statsFromHistory';

// All-time records for one exercise, derived from the History this device holds -- the same answer
// GET /exercises/{id}/records gives. Range-free: flipping 4wk/12wk/All leaves it untouched.
export function useExerciseRecords(personId, exerciseId) {
  const stats = useStatsFromHistory(personId);
  const records = useMemo(
    () => (stats.status === 'ready' && exerciseId ? exerciseRecords(stats.digests, exerciseId, { zone: VIEWER_ZONE }) : null),
    [stats.status, stats.digests, exerciseId],
  );
  return { records, loading: stats.status === 'loading', isFetching: stats.isFetching, refetch: stats.refetch };
}
