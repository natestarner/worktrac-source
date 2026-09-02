import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listRoutines } from '../api/routines';
import { queryKeys } from '../api/queryKeys';

export function useRoutines(personId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.routines(personId),
    queryFn: () => listRoutines(personId),
    enabled: !!personId,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.routines(personId) }),
    [queryClient, personId],
  );

  return {
    routines: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    updatedAt: query.dataUpdatedAt,
    // "Has a fetch actually completed since this observer mounted?" -- TanStack derives it from
    // dataUpdateCount against the observer's own initial snapshot, so a value that arrived by
    // hydrate() rather than over the network reads FALSE until a real fetch lands. That is the
    // distinction `dataUpdatedAt` cannot make: a restored entry carries the timestamp it had on
    // disk, so it looks freshly fetched (axis D in .claude/rules/resilience.md,
    // docs/incidents/2026-08-08-restored-cache-looks-fresh.md). Anything making a DESTRUCTIVE
    // decision from this list must gate on this, not on `updatedAt` -- see LogTab.
    fetchedAfterMount: query.isFetchedAfterMount,
    refetch,
  };
}
