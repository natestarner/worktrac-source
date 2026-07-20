import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listPersonExercises } from '../api/exercises';
import { queryKeys } from '../api/queryKeys';

// A person's Log-picker list: the exercises they've favorited, noted, or logged a set for, each
// with their personalization (isFavorite, applied tags, note). Everything else in the catalog is
// reached via search (useExercises). Keyed on personId so switching people reads that person's
// own list, never the previous person's.
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

  return { exercises: query.data ?? [], loading: query.isLoading, isFetching: query.isFetching, refetch };
}
