import { useCallback, useEffect, useState } from 'react';
import { listPersonCategories } from '../api/personCategories';

export function usePersonCategories(personId) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!personId) return Promise.resolve();
    return listPersonCategories(personId).then(setCategories);
  }, [personId]);

  useEffect(() => {
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  return { categories, loading, refetch };
}
