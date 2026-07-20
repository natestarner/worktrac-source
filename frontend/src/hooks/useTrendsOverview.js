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

  return { overview: query.data ?? null, loading: query.isLoading, isFetching: query.isFetching, refetch };
}
