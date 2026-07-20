import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listTags } from '../api/tags';
import { queryKeys } from '../api/queryKeys';

// The account's shared tag vocabulary. Account-level (no personId in the key), so it's fetched
// once and shared everywhere; invalidated after a tag is created/renamed/deleted so new chips
// appear.
export function useTags() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.tags(),
    queryFn: listTags,
    staleTime: 30 * 60 * 1000,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.tags() }),
    [queryClient],
  );

  return { tags: query.data ?? [], loading: query.isLoading, isFetching: query.isFetching, refetch };
}
