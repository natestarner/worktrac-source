import { useEffect } from 'react';
import { useQueryClient, onlineManager } from '@tanstack/react-query';
import { warmOfflineCache } from '../lib/offlineCacheWarm';

// Keeps other people's/tabs' data warm in the offline cache during a long session, on top of the
// initial/reconnect/foreground warm below -- the active person's own on-screen queries already
// self-refresh via normal use + refetchOnWindowFocus, so this is specifically for whoever ISN'T
// currently being looked at.
export const WARM_INTERVAL_MS = 5 * 60 * 1000;

// Owns the full trigger lifecycle for proactive cache warming, mirroring the moments App.jsx
// already uses for flushOutbox (online transition, tab regaining visibility) plus an initial
// warm and a periodic re-run. Every trigger gates on being online and (for the periodic timer)
// foregrounded, so a pinned-offline or backgrounded device never fires a warm attempt.
export function useOfflineCacheWarming(people) {
  const queryClient = useQueryClient();

  useEffect(() => {
    function warm() {
      warmOfflineCache(queryClient, people);
    }

    warm();

    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) warm();
    });

    function onVisible() {
      if (document.visibilityState === 'visible' && onlineManager.isOnline()) warm();
    }
    document.addEventListener('visibilitychange', onVisible);

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible' && onlineManager.isOnline()) warm();
    }, WARM_INTERVAL_MS);

    return () => {
      unsubscribeOnline();
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `people` is compared by identity from
    // useAuth(); a new array each render (e.g. `data.people` from a fresh /me response) is exactly
    // the signal that should re-run the initial warm with the updated roster.
  }, [queryClient, people]);
}
