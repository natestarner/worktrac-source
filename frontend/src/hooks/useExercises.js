import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listExercises } from '../api/exercises';
import { queryKeys } from '../api/queryKeys';

// The full exercise catalog. Account-shared (no personId in the key), so the Log picker and the
// Routines editor read ONE shared cache entry -- the catalog is fetched once and reused, not
// re-fetched per person or per tab. Kept fresh for a long window since the catalog rarely changes.
export function useExercises() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.exercises(),
    queryFn: listExercises,
    staleTime: 30 * 60 * 1000,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.exercises() }),
    [queryClient],
  );

  return { exercises: query.data ?? [], loading: query.isLoading, isFetching: query.isFetching, refetch };
}
