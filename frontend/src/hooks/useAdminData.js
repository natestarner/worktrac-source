import { useCallback, useEffect, useState } from 'react';

// Shared by every admin screen (Overview, Users, Accounts, Pending), generalized over the fetch
// function since all four screens otherwise repeat the identical boilerplate. This is the last
// hand-rolled fetch hook in the app -- the workout-app data hooks are TanStack Query (useQuery)
// wrappers now; the read-only admin portal deliberately stays outside that cache.
export function useAdminData(fetchFn) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refetch = useCallback(() => {
    setLoading(true);
    setError('');
    return fetchFn()
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [fetchFn]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
