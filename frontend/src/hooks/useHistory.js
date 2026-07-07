import { useCallback, useEffect, useState } from 'react';
import { getHistory } from '../api/sessions';

export function useHistory(personId) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!personId) return Promise.resolve();
    setLoading(true);
    return getHistory(personId).then(setHistory).finally(() => setLoading(false));
  }, [personId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { history, loading, refetch };
}
