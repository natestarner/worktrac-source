import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPrs } from '../api/stats';
import { queryKeys } from '../api/queryKeys';

export function usePrs(personId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.prs(personId),
    queryFn: () => getPrs(personId),
    enabled: !!personId,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.prs(personId) }),
    [queryClient, personId],
  );

  return { prs: query.data ?? [], loading: query.isLoading, isFetching: query.isFetching, refetch };
}
