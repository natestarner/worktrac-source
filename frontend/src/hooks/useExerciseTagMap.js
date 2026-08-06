import { useMemo } from 'react';
import { usePersonExercises } from './usePersonExercises';

// Client-side join from exerciseId -> this person's applied tags, sourced from the same
// offline-warmed usePersonExercises cache the Log picker/ConfigureExerciseModal already read
// (see offlineCacheWarm.js) -- no new query, no new query key, works offline for free.
//
// History and PRs deliberately retain rows for exercises soft-deleted from the catalog
// (PersonExerciseService.listForPerson filters those out of this list), so those exerciseIds
// simply have no entry here. Callers should treat "no entry" as "no tags", not an error -- those
// rows still match a text search, they just can never be matched by a tag filter.
export function useExerciseTagMap(personId) {
  const { exercises, loading } = usePersonExercises(personId);
  const tagsByExerciseId = useMemo(() => {
    const map = new Map();
    for (const ex of exercises) {
      if (ex.tags?.length) map.set(ex.id, ex.tags);
    }
    return map;
  }, [exercises]);
  return { tagsByExerciseId, loading };
}
