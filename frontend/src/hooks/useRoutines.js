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

  return { routines: query.data ?? [], loading: query.isLoading, isFetching: query.isFetching, refetch };
}
