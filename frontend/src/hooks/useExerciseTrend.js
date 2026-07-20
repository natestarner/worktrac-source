import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getExerciseTrend } from '../api/trends';
import { queryKeys } from '../api/queryKeys';

export function useExerciseTrend(personId, exerciseId, weeks) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.exerciseTrend(personId, exerciseId, weeks),
    queryFn: () => getExerciseTrend(personId, exerciseId, weeks),
    enabled: !!personId && !!exerciseId,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.exerciseTrend(personId, exerciseId, weeks) }),
    [queryClient, personId, exerciseId, weeks],
  );

  return { points: query.data ?? [], loading: query.isLoading, isFetching: query.isFetching, refetch };
}
