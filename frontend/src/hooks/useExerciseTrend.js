import { useCallback, useEffect, useState } from 'react';
import { getExerciseTrend } from '../api/trends';

export function useExerciseTrend(personId, exerciseId, weeks) {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!personId || !exerciseId) {
      setPoints([]);
      return Promise.resolve();
    }
    setLoading(true);
    return getExerciseTrend(personId, exerciseId, weeks).then(setPoints).finally(() => setLoading(false));
  }, [personId, exerciseId, weeks]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { points, loading, refetch };
}
