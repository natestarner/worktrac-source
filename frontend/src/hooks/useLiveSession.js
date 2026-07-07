import { useCallback, useEffect, useState } from 'react';
import { getLiveSession } from '../api/sessions';

export function useLiveSession(personId) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!personId) return;
    setLoading(true);
    getLiveSession(personId)
      .then(setSession)
      .finally(() => setLoading(false));
  }, [personId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { session, loading, refetch };
}
