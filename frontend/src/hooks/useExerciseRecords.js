import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getExerciseRecords } from '../api/trends';
import { queryKeys } from '../api/queryKeys';

// All-time records for one exercise. Keyed without the range so switching 4wk/12wk/All reuses the
// cached response instead of refetching -- see queryKeys.exerciseRecords.
export function useExerciseRecords(personId, exerciseId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.exerciseRecords(personId, exerciseId),
    queryFn: () => getExerciseRecords(personId, exerciseId),
    enabled: !!personId && !!exerciseId,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.exerciseRecords(personId, exerciseId) }),
    [queryClient, personId, exerciseId],
  );

  return { records: query.data ?? null, loading: query.isLoading, isFetching: query.isFetching, refetch };
}
