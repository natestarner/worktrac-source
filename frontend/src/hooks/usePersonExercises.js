import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listPersonExercises } from '../api/exercises';
import { queryKeys } from '../api/queryKeys';

// A person's Log-picker list: the exercises they've favorited, noted, or logged a set for, each
// with their personalization (isFavorite, applied tags, note). Everything else in the catalog is
// reached via search (useExercises). Keyed on personId so switching people reads that person's
// own list, never the previous person's.
// One empty list for every render with no data yet, so what is built from it (useExerciseTagMap)
// stays the same object and memoized consumers (History's SessionBlock) do not all re-render.
const NO_EXERCISES = [];

export function usePersonExercises(personId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.personExercises(personId),
    queryFn: () => listPersonExercises(personId),
    enabled: !!personId,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.personExercises(personId) }),
    [queryClient, personId],
  );

  return { exercises: query.data ?? NO_EXERCISES, loading: query.isLoading, isFetching: query.isFetching, refetch };
}
