import { useCallback, useEffect, useState } from 'react';
import { listTags } from '../api/tags';

// The account's shared tag vocabulary. Tags are account-level (no personId), fetched once on
// mount; call refetch after a tag is created/renamed/deleted so new chips appear.
export function useTags() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => listTags().then(setTags), []);

  useEffect(() => {
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  return { tags, loading, refetch };
}
