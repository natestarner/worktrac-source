import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getTrendsOverview } from '../api/trends';
import { queryKeys } from '../api/queryKeys';

export function useTrendsOverview(personId, weeks) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.trendsOverview(personId, weeks),
    queryFn: () => getTrendsOverview(personId, weeks),
    enabled: !!personId,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.trendsOverview(personId, weeks) }),
    [queryClient, personId, weeks],
  );

  // isPaused/isError are what stop TrendsTab latching a skeleton over a request that will never
  // succeed. Trends is deliberately excluded from offlineCacheWarm (a costly prefetch fan-out
  // across every person), so a device with no cached overview has nothing to fall back to -- and
  // offline the query PAUSES, which means isLoading is false and data is undefined at the same
  // time. "Loading" and "never going to load" are indistinguishable without these two.
  return {
    overview: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isPaused: query.isPaused,
    isError: query.isError,
    updatedAt: query.dataUpdatedAt,
    refetch,
  };
}
