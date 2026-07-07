import { useCallback, useEffect, useState } from 'react';
import { listExercises } from '../api/exercises';

export function useExercises() {
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(
    () => listExercises().then(setExercises).finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { exercises, loading, refetch };
}
