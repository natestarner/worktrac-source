import { useCallback, useEffect, useState } from 'react';

// Shared by every admin screen (Overview, Users, Accounts, Pending) -- same
// fetch/loading/error shape as useHistory/useTrendsOverview, generalized over the fetch
// function since all four screens otherwise repeat the identical boilerplate.
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
