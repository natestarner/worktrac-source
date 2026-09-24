import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getHistory } from '../api/sessions';
import { queryKeys } from '../api/queryKeys';

// `fetch: false` reads whatever this person's history cache already holds without fetching it.
// That is different from passing a null personId, which reads a DIFFERENT (always empty) key: a
// caller that only wants to avoid a fetch must not also lose the cache, or anything folded over
// it -- record marks in particular -- silently compares against no history at all.
export function useHistory(personId, { fetch = true } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.history(personId),
    queryFn: () => getHistory(personId, { readCached: () => queryClient.getQueryData(queryKeys.history(personId)) }),
    enabled: !!personId && fetch,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.history(personId) }),
    [queryClient, personId],
  );

  return { history: query.data ?? [], loading: query.isLoading, isFetching: query.isFetching, updatedAt: query.dataUpdatedAt, refetch };
}
