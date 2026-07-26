import { useEffect, useState } from 'react';
import { useOfflinePin } from './useOfflinePin';
import { probeReachability } from '../lib/reachabilityProbe';

const INITIAL_DELAY_MS = 5000;
const MAX_DELAY_MS = 60000;

// While manually pinned offline, periodically checks whether the server is actually reachable
// again, backing off up to a minute between checks so a still-dead connection isn't hammered.
// Deliberately never flips the app back online itself -- see offlineMode.js's "recovery never
// auto-flips" design -- it only reports "reachable" so OfflineRecoveryPrompt can ask the user to
// confirm. Shares its probe (lib/reachabilityProbe.js) with the offline banner's "Go back online"
// button, which does the same check on demand instead of on a timer.
export function useOfflineRecoveryHeartbeat() {
  const pinned = useOfflinePin();
  const [reachable, setReachable] = useState(false);

  useEffect(() => {
    if (!pinned) {
      setReachable(false);
      return undefined;
    }

    let cancelled = false;
    let timeoutId;
    let delay = INITIAL_DELAY_MS;

    async function ping() {
      const ok = await probeReachability();
      if (cancelled) return;
      if (ok) {
        setReachable(true);
        return;
      }
      delay = Math.min(delay * 2, MAX_DELAY_MS);
      timeoutId = setTimeout(ping, delay);
    }

    timeoutId = setTimeout(ping, delay);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [pinned]);

  return reachable;
}
