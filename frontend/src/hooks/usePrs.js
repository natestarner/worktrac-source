import { useMemo } from 'react';
import { useStatsFromHistory } from './useStatsFromHistory';
import { prBoard } from '../utils/statsFromHistory';

// The PRs board, derived from the History this device holds (useStatsFromHistory) -- the same rows
// GET /prs returns, field for field (shared/record-rules/stats-from-history-cases.json). No request
// of its own: it is as fresh as History, works offline, and shows a set the moment it is logged.
export function usePrs(personId) {
  const stats = useStatsFromHistory(personId);
  const prs = useMemo(() => (stats.status === 'ready' ? prBoard(stats.digests) : []), [stats.status, stats.digests]);
  return {
    prs,
    status: stats.status,
    loading: stats.status === 'loading',
    isFetching: stats.isFetching,
    updatedAt: stats.updatedAt,
    refetch: stats.refetch,
  };
}
