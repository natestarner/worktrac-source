import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';

// Bump when the shape of anything we cache changes incompatibly -- the persister discards a
// restored cache whose buster doesn't match instead of hydrating stale/incompatible data.
export const QUERY_CACHE_BUSTER = 'v1';

const ONE_DAY = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A moderate freshness window so returning to a view you saw recently paints instantly
      // and does NOT refetch (no "Refreshing..." pill, no value pop). Window-focus refetch only
      // refires queries that have actually gone stale past this.
      staleTime: 60 * 1000,
      // Must be >= the persister maxAge below, or persisted entries would be garbage-collected
      // out of the in-memory cache before they can be restored.
      gcTime: ONE_DAY,
      retry: 2,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Reads are safe to retry a couple times; log-set and other writes opt into their own
      // retry policy at the useMutation call site (with an idempotency key so a replay can't
      // double-insert).
      retry: 0,
    },
  },
});

// IndexedDB (not localStorage) so the cache survives on iOS/PWA and is the same durable store
// offline mode will build on. idb-keyval's get/set/del are the async storage contract the
// persister expects. Guarded so that environments without IndexedDB (jsdom/unit tests, SSR) no-op
// cleanly instead of throwing -- persistence is a progressive enhancement, never a hard dependency.
const idbAvailable = typeof indexedDB !== 'undefined';
const idbStorage = {
  getItem: (key) => (idbAvailable ? get(key) : Promise.resolve(null)),
  setItem: (key, value) => (idbAvailable ? set(key, value) : Promise.resolve()),
  removeItem: (key) => (idbAvailable ? del(key) : Promise.resolve()),
};

export const queryPersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: 'worktrac-query-cache',
  throttleTime: 1000,
});

export const persistOptions = {
  persister: queryPersister,
  maxAge: ONE_DAY,
  buster: QUERY_CACHE_BUSTER,
};

// Called on every auth transition (login success + logout). The exercise catalog and tag
// vocabulary are keyed WITHOUT an accountId, so without this a second household logging in on
// the same device could read the first household's cached catalog. Clearing both the live cache
// and the persisted copy on any auth change makes cross-account bleed impossible.
export function resetQueryCache() {
  queryClient.clear();
  queryPersister.removeClient();
}
