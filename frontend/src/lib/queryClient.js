import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';
import { queryKeys } from '../api/queryKeys';
import { logLiveSet, logSetIntoSession } from '../api/sets';
import { addExercise, favoriteExercise } from '../api/exercises';
import { OUTBOX_SCOPE_ID } from './outboxPersistence';
import { resolveExerciseId, setExerciseIdMapping } from './exerciseIdMap';

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
      // Reads are safe to retry a couple times; writes opt into their own retry policy (with an
      // idempotency key so a replay can't double-insert).
      retry: 0,
    },
  },
});

// Durable log-set defaults, registered by mutationKey so a mutation RESTORED from the offline outbox
// (functions don't serialize) can replay -- its mutationFn, retry, scope, and reconciliation are all
// re-attached from here at hydrate time. Everything the replay needs comes from serializable
// `variables`; nothing is captured from a component closure.
//
// Registered via a function (not inline) so a fresh client -- notably the per-test client in
// test/queryWrapper.jsx -- can be given the exact same defaults; tests pass `retry: false` so a
// mocked rejection surfaces immediately instead of running the production backoff.
export const LOG_SET_MUTATION_KEY = ['logSet'];
export const CREATE_EXERCISE_MUTATION_KEY = ['createExercise'];

// Failure taxonomy (hardening #8) as a pure, testable predicate: a real 4xx is the server's answer
// -> stop. Anything else (a 5xx / cold-start 503 / timeout / gateway error == server unreachable, or
// a fetch reject with no status) is transient -> keep retrying with backoff rather than dropping the
// write. (Fully offline never reaches here -- networkMode pauses the mutation before it errors.)
export function shouldRetryWrite(failureCount, error) {
  if (error?.status >= 400 && error?.status < 500) return false;
  return failureCount < 8;
}

export function registerOfflineMutationDefaults(client, { retry } = {}) {
  client.setMutationDefaults(LOG_SET_MUTATION_KEY, {
    // One shared scope => queued writes replay STRICTLY SERIALLY in enqueue order (hardening #2), so
    // sets land in order (keeping rest_seconds honest) and, later, an exercise-create replays before
    // the sets that depend on it. It's also the marker the outbox persister uses to decide which
    // paused mutations are durable (i.e. have a registered replayable mutationFn).
    scope: { id: OUTBOX_SCOPE_ID },
    mutationFn: (vars) => {
      const payload = {
        // Resolve a temp exercise id (a set logged offline against a just-created, not-yet-synced
        // exercise) to its real server id, now known because the create replayed first -- the shared
        // serial scope guarantees that ordering (PR 4). A normal numeric id passes through unchanged.
        exerciseId: resolveExerciseId(vars.exerciseId),
        weight: vars.weight,
        reps: vars.reps,
        idempotencyKey: vars.idempotencyKey,
        clientLoggedAt: vars.clientLoggedAt,
      };
      return vars.mode === 'session'
        ? logSetIntoSession(vars.sessionId, payload)
        : logLiveSet(vars.personId, payload);
    },
    // Failure taxonomy (hardening #8) -- see shouldRetryWrite. Tests pass `retry: false` to fail fast.
    retry: retry ?? shouldRetryWrite,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    // Runs for BOTH an interactive log and a restored/replayed one (which has no component observer),
    // so History/PRs/sets reconcile to server truth once a queued write finally syncs. Uses the
    // server's returned session id when present (a live set's session may not exist at dispatch).
    onSettled: (data, _error, vars) => {
      const sessionId = data?.session?.id ?? vars.sessionId ?? null;
      client.invalidateQueries({ queryKey: queryKeys.sessionSets(sessionId, vars.exerciseId) });
      client.invalidateQueries({ queryKey: queryKeys.exerciseSummary(vars.personId, vars.exerciseId, sessionId) });
      if (vars.mode !== 'session') {
        client.invalidateQueries({ queryKey: queryKeys.liveSession(vars.personId) });
      }
      client.invalidateQueries({ queryKey: queryKeys.prs(vars.personId) });
      client.invalidateQueries({ queryKey: queryKeys.history(vars.personId) });
    },
  });

  // Durable "create your own exercise" (PR 4). One mutation does the two dependent server calls --
  // create the exercise, then auto-favorite it -- both idempotent (create dedupes on idempotencyKey;
  // favorite is an idempotent PUT), so a replay can't duplicate. On success it records the temp->real
  // id mapping so any set-logs queued against the temp id resolve correctly, and refreshes the
  // catalog/picker so the real exercise takes the optimistic temp one's place.
  client.setMutationDefaults(CREATE_EXERCISE_MUTATION_KEY, {
    scope: { id: OUTBOX_SCOPE_ID },
    mutationFn: async (vars) => {
      const created = await addExercise({ name: vars.name, idempotencyKey: vars.idempotencyKey });
      if (vars.personId) await favoriteExercise(vars.personId, created.id);
      return created;
    },
    retry: retry ?? shouldRetryWrite,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    onSettled: (created, _error, vars) => {
      if (created?.id) {
        setExerciseIdMapping(vars.tempId, created.id);
        client.invalidateQueries({ queryKey: queryKeys.exercises() });
        client.invalidateQueries({ queryKey: queryKeys.personExercises(vars.personId) });
      }
    },
  });
}

registerOfflineMutationDefaults(queryClient);

// Replay any queued writes now (called on reconnect and after the outbox is restored on boot). Only
// paused mutations resume; the shared scope keeps them strictly serial and in order.
export function resumeOutbox() {
  return queryClient.resumePausedMutations();
}

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
  // Queries ONLY. Unsynced writes are NOT persisted here -- they live in the separate durable
  // outbox (lib/outboxPersistence.js), which has no maxAge and no buster, so a >24h offline gap or
  // an app update (which changes the buster and discards this cache) can never drop a queued write.
  dehydrateOptions: {
    shouldDehydrateMutation: () => false,
  },
};

// Called on every auth transition (login success + logout). The exercise catalog and tag
// vocabulary are keyed WITHOUT an accountId, so without this a second household logging in on
// the same device could read the first household's cached catalog. Clearing both the live cache
// and the persisted copy on any auth change makes cross-account bleed impossible.
export function resetQueryCache() {
  queryClient.clear();
  queryPersister.removeClient();
}
