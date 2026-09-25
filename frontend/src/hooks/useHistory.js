import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getHistory } from '../api/sessions';
import { queryKeys } from '../api/queryKeys';
import { flattenHistory } from '../lib/historySync';
import { refreshHistory } from '../lib/queryClient';

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
    // The cache holds History a month at a time (lib/historySync.js); every reader gets the flat,
    // newest-first list. A stable module-level function, so TanStack only re-flattens when the data
    // actually changed -- and unchanged months keep their sessions by identity.
    select: flattenHistory,
  });

  // The same refresh every writer uses (lib/queryClient.js#refreshHistory): cancel a fetch still in
  // flight from before the change, then fetch whether or not this observer is enabled.
  const refetch = useCallback(() => refreshHistory(queryClient, personId), [queryClient, personId]);

  return { history: query.data ?? [], loading: query.isLoading, isFetching: query.isFetching, updatedAt: query.dataUpdatedAt, refetch };
}
