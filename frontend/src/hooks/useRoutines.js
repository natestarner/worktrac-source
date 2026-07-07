import { useCallback, useEffect, useState } from 'react';
import { listRoutines } from '../api/routines';

export function useRoutines(personId) {
  const [routines, setRoutines] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!personId) return Promise.resolve();
    setLoading(true);
    return listRoutines(personId).then(setRoutines).finally(() => setLoading(false));
  }, [personId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { routines, loading, refetch };
}
