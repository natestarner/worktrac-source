import { useCallback, useEffect, useState } from 'react';
import { listPersonExercises } from '../api/exercises';

// A person's Log-picker list: the exercises they've favorited or logged a set for, each with
// their personalization (isFavorite, personCategoryId/Name). Everything else in the catalog is
// reached via search (useExercises).
export function usePersonExercises(personId) {
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!personId) return Promise.resolve();
    return listPersonExercises(personId).then(setExercises);
  }, [personId]);

  useEffect(() => {
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  return { exercises, loading, refetch };
}
