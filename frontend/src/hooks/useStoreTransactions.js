import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useOnlineStatus } from './useOnlineStatus';
import { queryKeys } from '../api/queryKeys';
import { refreshHistoryForEveryone } from '../lib/queryClient';
import { onTransaction, storeSource, unfinishedTransactions } from '../lib/native';
import { syncAndFinish } from '../lib/storeSync';

// Store transactions that arrive with no purchase screen open: a renewal, an Ask to Buy request a
// parent approved days later, a purchase on another device, or a purchase whose confirmation never
// reached our backend (the app died, or the backend was down). Mounted once, in AppShell, so it
// runs only while someone is signed in. A no-op on the web: there is no store.
//
// Two ways in, one path out (lib/storeSync.syncAndFinish):
//   - the store's own listener, for anything that happens while the app is open;
//   - a sweep of every UNFINISHED transaction on mount, on every return to the app, and whenever
//     the device reports it is back online -- which is what retries a sync that failed. Nothing
//     else retries it: an unfinished transaction is the queue, and the store keeps it until we
//     finish it after a 2xx.
//
// The re-sweep on coming back online is not a connectivity BRANCH: the sweep is the same call in
// every mode, and offline it simply fails and leaves everything unfinished.
export function useStoreTransactions() {
  const { refreshPeople } = useAuth();
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const refreshRef = useRef(null);

  // Whatever a store transaction could have changed: the plan (/me, which every badge reads), the
  // billing screen's wording, and every person's History window.
  refreshRef.current = () => {
    refreshPeople().catch(() => {});
    queryClient.invalidateQueries({ queryKey: queryKeys.subscription() });
    refreshHistoryForEveryone(queryClient);
    queryClient.invalidateQueries({ queryKey: queryKeys.historyWindowForEveryone() });
  };

  useEffect(() => {
    if (!storeSource()) return undefined;
    return onTransaction((transaction) => {
      syncAndFinish([transaction])
        .then(() => refreshRef.current())
        .catch(() => {
          // Left unfinished; the next sweep sends it again.
        });
    });
  }, []);

  useEffect(() => {
    if (!storeSource()) return undefined;
    let alive = true;
    const sweep = () => {
      unfinishedTransactions()
        .then((proofs) => (proofs.length ? syncAndFinish(proofs) : null))
        .then((subscription) => {
          if (alive && subscription) refreshRef.current();
        })
        .catch(() => {
          // Left unfinished; the next sweep sends them again.
        });
    };
    sweep();
    const onVisible = () => {
      if (document.visibilityState === 'visible') sweep();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // `online` re-runs the sweep when the device comes back: see the header.
  }, [online]);
}
