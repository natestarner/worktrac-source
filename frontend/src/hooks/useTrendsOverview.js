import { useCallback, useEffect, useState } from 'react';
import { getTrendsOverview } from '../api/trends';

export function useTrendsOverview(personId, weeks) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!personId) return Promise.resolve();
    setLoading(true);
    return getTrendsOverview(personId, weeks).then(setOverview).finally(() => setLoading(false));
  }, [personId, weeks]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { overview, loading, refetch };
}
