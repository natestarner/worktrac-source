import { useCallback, useEffect, useState } from 'react';
import { listCategories } from '../api/categories';

export function useCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(
    () => listCategories().then(setCategories).finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { categories, loading, refetch };
}
