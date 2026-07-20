import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getHistory } from '../api/sessions';
import { queryKeys } from '../api/queryKeys';

export function useHistory(personId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.history(personId),
    queryFn: () => getHistory(personId),
    enabled: !!personId,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.history(personId) }),
    [queryClient, personId],
  );

  return { history: query.data ?? [], loading: query.isLoading, isFetching: query.isFetching, refetch };
}
