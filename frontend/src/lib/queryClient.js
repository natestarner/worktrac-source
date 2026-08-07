import { QueryClient, MutationObserver } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';
import { queryKeys } from '../api/queryKeys';
import { logLiveSet, logSetIntoSession, editSet, deleteSet } from '../api/sets';
import { addExercise, favoriteExercise, unfavoriteExercise } from '../api/exercises';
import { saveLiveExerciseNote, saveSessionExerciseNote } from '../api/notes';
import { endWorkout } from '../api/sessions';
import { getAuthToken } from '../api/client';
import { OUTBOX_SCOPE_ID } from './outboxPersistence';
import { resolveExerciseId, setExerciseIdMapping, isTempExerciseId } from './exerciseIdMap';
import { resolveSetId, setSetIdMapping, isTempSetId } from './setIdMap';
import { byEnqueueOrder, withEnqueueSeq } from './outboxSequence';

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
export const EDIT_SET_MUTATION_KEY = ['editSet'];
export const DELETE_SET_MUTATION_KEY = ['deleteSet'];
export const SAVE_NOTE_MUTATION_KEY = ['saveNote'];
export const END_WORKOUT_MUTATION_KEY = ['endWorkout'];
export const FAVORITE_MUTATION_KEY = ['favorite'];

// Failure taxonomy (hardening #8) as a pure, testable predicate: a real 4xx is the server's answer
// -> stop, since retrying it can never succeed and (in the serial outbox scope) would otherwise
// block every write queued behind it forever. Anything else (a 5xx / cold-start 503 / timeout /
// gateway error == server unreachable, or a fetch reject with no status) is transient -> retry
// FOREVER with backoff rather than eventually dropping the write and going quiet. "Durable" means
// a connectivity problem can never be the reason a write is lost or silently stops trying; only a
// definitive rejection from the server can end retries. (Fully offline never reaches here --
// networkMode pauses the mutation before it errors.)
export function shouldRetryWrite(_failureCount, error) {
  if (error?.status >= 400 && error?.status < 500) return false;
  return true;
}

// "Has this write NOT reached the server yet?" -- the display counterpart to shouldRetryWrite
// above, and the single predicate every screen that renders unsynced writes must share.
//
// Deliberately NOT `status === 'pending'`: a write whose retries have settled against an
// unreachable server sits in 'error', but it is still queued, still durable, and still guaranteed
// to sync (shouldRetryWrite retries transient failures forever, and flushOutbox restarts stuck
// ones on reconnect). Hiding it would tell the person their set is gone while the outbox badge
// still counts it. Only two states mean "stop showing this": 'success' (it landed), and a
// definitive 4xx (the server's real answer, which onError has already rolled back).
//
// Takes the flat { status, errorStatus } shape so it works both on a raw Mutation
// (`{ status: m.state.status, errorStatus: m.state.error?.status }`) and on the projection
// useMutationState's `select` already produces.
//
// Note this answers a DIFFERENT question from useOutboxCount's "is it queued or struggling",
// which deliberately excludes a brand-new online first attempt so a fast successful write doesn't
// flash the banner. Don't unify those two.
export function isUnsyncedWrite({ status, errorStatus }) {
  if (status === 'success') return false;
  return !(status === 'error' && errorStatus >= 400 && errorStatus < 500);
}

// Thrown by a dependent write's mutationFn (log-set, note, favorite) when the exercise id it needs
// is still an unresolved temp id -- i.e. the exercise-create it depends on hasn't synced yet. This
// error carries no `.status`, so shouldRetryWrite treats it as transient and keeps retrying/requeuing
// rather than sending the raw "temp-exercise-<uuid>" string to the server: the backend's exerciseId
// field is a Long, so that request can never succeed and previously surfaced as a malformed-request
// failure that (before the backend fix) collapsed into a session-killing 401.
class UnresolvedExerciseIdError extends Error {
  constructor(tempId) {
    super(`Exercise ${tempId} has not finished syncing yet`);
    this.name = 'UnresolvedExerciseIdError';
  }
}

function requireResolvedExerciseId(id) {
  const resolved = resolveExerciseId(id);
  if (isTempExerciseId(resolved)) throw new UnresolvedExerciseIdError(resolved);
  return resolved;
}

// Same shape as UnresolvedExerciseIdError, for a durable edit dispatched against a set that hasn't
// synced yet -- see EDIT_SET_MUTATION_KEY below and offlineSetEdits.js's setIdMap-based redesign
// (an edit to a still-queued set is now a genuinely separate write targeting the create's tempId,
// never a mutation of the queued create itself -- TanStack has no public way to update or cancel an
// in-flight mutation, and mutating the create in place risks the backend's idempotency dedup
// silently discarding the edit if the original create had already reached the server).
class UnresolvedSetIdError extends Error {
  constructor(tempId) {
    super(`Set ${tempId} has not finished syncing yet`);
    this.name = 'UnresolvedSetIdError';
  }
}

function requireResolvedSetId(id) {
  const resolved = resolveSetId(id);
  if (isTempSetId(resolved)) throw new UnresolvedSetIdError(resolved);
  return resolved;
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
        // If the create hasn't synced yet (still resolves to a temp id), this throws instead of
        // sending the server a string it can't parse as a Long -- see requireResolvedExerciseId.
        exerciseId: requireResolvedExerciseId(vars.exerciseId),
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
      // Record the temp->real set id mapping on success, so any EDIT_SET queued against this set's
      // tempId (see offlineSetEdits.js) resolves correctly once it replays -- mirrors
      // CREATE_EXERCISE's onSettled below recording the temp->real EXERCISE id mapping.
      if (data?.set?.id && vars.tempId) {
        setSetIdMapping(vars.tempId, data.set.id);
      }
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

  // The rest of the active-workout loop, all durable (outbox scope) so they queue offline and replay
  // in order. `durable` factors out the shared scope + failure-taxonomy retry/backoff.
  const durable = (extra) => ({
    scope: { id: OUTBOX_SCOPE_ID },
    retry: retry ?? shouldRetryWrite,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    ...extra,
  });

  const reconcileSetChange = (vars) => {
    client.invalidateQueries({ queryKey: queryKeys.sessionSets(vars.sessionId, vars.exerciseId) });
    client.invalidateQueries({ queryKey: queryKeys.exerciseSummary(vars.personId, vars.exerciseId, vars.sessionId) });
    client.invalidateQueries({ queryKey: queryKeys.prs(vars.personId) });
    client.invalidateQueries({ queryKey: queryKeys.history(vars.personId) });
  };

  // Edit a set's weight/reps. Also reachable against a set that hasn't synced yet -- correcting a
  // still-queued offline set is now a genuinely separate durable write targeting the create's tempId
  // (see offlineSetEdits.js), never a mutation of the queued create itself, so setId resolves through
  // the same temp-id map exerciseId does above. A real numeric id (the common, already-synced case)
  // passes through unchanged. If the create hasn't synced yet (still resolves to a temp id), this
  // throws instead of sending the server a string it can't parse as a Long -- see requireResolvedSetId
  // -- and the shared serial outbox scope guarantees the create replays first, exactly like
  // requireResolvedExerciseId above. Idempotent (same value re-applied).
  client.setMutationDefaults(EDIT_SET_MUTATION_KEY, durable({
    mutationFn: (vars) => editSet(requireResolvedSetId(vars.setId), { weight: vars.weight, reps: vars.reps }),
    onSettled: (_d, _e, vars) => reconcileSetChange(vars),
  }));

  // Delete a set. A replay of an already-applied delete comes back 404 -- that's the intended end
  // state (already gone), so treat it as success rather than a stuck error (hardening).
  client.setMutationDefaults(DELETE_SET_MUTATION_KEY, durable({
    mutationFn: async (vars) => {
      try {
        return await deleteSet(vars.setId);
      } catch (error) {
        if (error?.status === 404) return null;
        throw error;
      }
    },
    onSettled: (_d, _e, vars) => reconcileSetChange(vars),
  }));

  // Save/clear a note (blank clears it server-side). Natural idempotent upsert. A live note may
  // materialize the session, so refresh liveSession too. exerciseId resolves through the id map so a
  // note on an offline-created exercise lands on the real one.
  client.setMutationDefaults(SAVE_NOTE_MUTATION_KEY, durable({
    mutationFn: (vars) => {
      const exerciseId = requireResolvedExerciseId(vars.exerciseId);
      return vars.mode === 'session'
        ? saveSessionExerciseNote(vars.sessionId, exerciseId, vars.note)
        : saveLiveExerciseNote(vars.personId, { exerciseId, note: vars.note });
    },
    onSettled: (data, _e, vars) => {
      // A live note may have just materialized the session -- use the returned session id.
      const sessionId = data?.sessionId ?? vars.sessionId ?? null;
      client.invalidateQueries({ queryKey: queryKeys.sessionExerciseNote(sessionId, vars.exerciseId) });
      client.invalidateQueries({ queryKey: queryKeys.exerciseSummary(vars.personId, vars.exerciseId, sessionId) });
      client.invalidateQueries({ queryKey: queryKeys.history(vars.personId) });
      if (vars.mode !== 'session') client.invalidateQueries({ queryKey: queryKeys.liveSession(vars.personId) });
    },
  }));

  // End the live workout. Idempotent (ending an already-ended/absent session is a no-op server-side).
  client.setMutationDefaults(END_WORKOUT_MUTATION_KEY, durable({
    mutationFn: (vars) => endWorkout(vars.personId),
    onSettled: (_d, _e, vars) => {
      client.invalidateQueries({ queryKey: queryKeys.liveSession(vars.personId) });
      client.invalidateQueries({ queryKey: queryKeys.history(vars.personId) });
    },
  }));

  // Favorite / unfavorite. Idempotent booleans; exerciseId resolves through the id map.
  client.setMutationDefaults(FAVORITE_MUTATION_KEY, durable({
    mutationFn: (vars) => {
      const exerciseId = requireResolvedExerciseId(vars.exerciseId);
      return vars.favorite ? favoriteExercise(vars.personId, exerciseId) : unfavoriteExercise(vars.personId, exerciseId);
    },
    onSettled: (_d, _e, vars) => {
      client.invalidateQueries({ queryKey: queryKeys.personExercises(vars.personId) });
      client.invalidateQueries({ queryKey: queryKeys.exercises() });
    },
  }));
}

registerOfflineMutationDefaults(queryClient);

// Fire a durable write against an EXPLICIT client, without a React observer. Shared by
// enqueueOutboxWrite below (the app singleton) and by any caller that already has its own
// QueryClient via context and needs the write to land in that SAME mutation cache -- e.g.
// EditSetModal.jsx dispatching an EDIT_SET write that must resolve a temp set id against whichever
// client's cache holds the matching pending `logSet` create (see setIdMap.js/offlineSetEdits.js).
export function dispatchDurableWrite(client, mutationKey, variables) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(mutationKey),
    mutationKey,
  });
  // Stamps an immutable enqueueSeq the first time this write is dispatched (a no-op if variables
  // already carries one, e.g. a restore re-dispatch) -- see outboxSequence.js.
  return observer.mutate(withEnqueueSeq(variables)).catch(() => {});
}

// Fire a durable write against the app's singleton client WITHOUT a React observer -- for
// fire-and-dismiss actions (end workout) whose component has no QueryClientProvider dependency at
// all (see EndWorkoutConfirmModal.jsx, which imports the singleton directly and never calls
// useQueryClient()). The write still queues + replays via the outbox exactly like a
// useMutation-dispatched one. A component that already has `useQueryClient()` should call
// dispatchDurableWrite with its own context client instead of this -- see there for why.
export function enqueueOutboxWrite(mutationKey, variables) {
  return dispatchDurableWrite(queryClient, mutationKey, variables);
}

// Replay every queued write now: paused ones via TanStack's own `resumePausedMutations` (which
// keeps them strictly serial, in order, via the shared outbox scope), PLUS any write that's sitting
// in a terminal ERROR state (exhausted retries, or a definitive 4xx like an expired session) --
// those have nothing left to resume on their own, so they're restarted fresh from their persisted
// variables, safe because every durable write is idempotent by design. A write that's currently
// mid-retry (pending, not paused) is left alone rather than double-fired.
//
// Restarted IN PLACE (`m.execute(...)` on the existing Mutation object) rather than removed and
// re-dispatched via a new mutation -- removing and recreating always re-registers at the END of
// the shared outbox scope's array, which is what actually determines LIVE replay order (TanStack's
// scope FIFO is registration order), so it could let a write that's stuck behind a dependency
// (e.g. a log-set against a not-yet-synced exercise) jump ahead of writes genuinely submitted
// later. Reusing the same object never changes its position. This is only safe because
// `state.status === 'error'` here means the mutation's retryer already fully settled (rejected) --
// there is no live retry loop left to race against a second one; had it been 'pending' (offline or
// mid-backoff), a second `execute()` call would start a competing retryer without cancelling the
// first.
//
// The stuck list itself is sorted by `byEnqueueOrder` (outboxSequence.js's immutable, app-assigned
// `enqueueSeq`, stamped once into `variables` at first dispatch) rather than TanStack's own
// `submittedAt` -- `execute()` re-stamps `submittedAt` to "now" as part of its normal re-dispatch
// (mutation.ts's 'pending' reducer case), so keying restore/reconnect ordering off it would require
// capturing and restoring it around every re-execute, in every place that ever re-runs a mutation,
// forever. `enqueueSeq` lives in `variables`, which `execute()` never touches, so there is nothing
// to preserve here -- a later restoreOutbox restore (after a reload) sorts by the same untouched key.
//
// Called on reconnect, after the outbox is restored on boot, after a successful (re-)login, and
// from the offline banner's guarded "Go back online" button -- every one of those call sites can
// fire while there is no authenticated session (a stale/cleared token, or the moment right after a
// forced sign-out), so this is the single choke point that guarantees a queued write NEVER
// dispatches with no Authorization header. Without a token that request would 401, and a 401 can
// itself tear a session back down (see api/client.js's unauthorized handler) -- exactly the
// mechanism that turned a handful of queued offline writes into a login loop.
export function flushOutbox() {
  if (!getAuthToken()) return [];
  const resumed = queryClient.resumePausedMutations();
  const cache = queryClient.getMutationCache();
  const stuck = cache
    .getAll()
    .filter((m) => m.options.scope?.id === OUTBOX_SCOPE_ID && m.state.status === 'error')
    .sort(byEnqueueOrder);
  stuck.forEach((m) => {
    m.execute(m.state.variables).catch(() => {});
  });
  return resumed;
}

// Evicts every outbox-scoped mutation from the LIVE in-memory cache only -- does NOT touch the
// persisted IndexedDB copy under whichever account currently owns it. Used when a different
// account is about to become active and a stale write must not be able to replay under the wrong
// session (see AuthContext's adoptOutboxAccount), and by an explicit logout's full discard
// (alongside clearOutbox, which removes the IndexedDB copy too).
export function clearOutboxMutations() {
  const cache = queryClient.getMutationCache();
  cache
    .getAll()
    .filter((m) => m.options.scope?.id === OUTBOX_SCOPE_ID)
    .forEach((m) => cache.remove(m));
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

// TanStack's own default (`query.state.status === 'success'`) drops a query the instant its most
// recent fetch attempt fails -- even if it's still holding perfectly good data from an earlier
// success. During lie-fi (backend unreachable, navigator.onLine still true), ordinary background
// refetches (window-focus, the offline-cache-warm cycle, a mutation's onSettled invalidation) keep
// firing and failing, so more and more queries accumulate this status while their `data` sits
// untouched in memory -- harmless on its own. But a silent forced reload (swUpdate.js's
// tryForceUpdate, which fires on an ordinary section/person switch whenever a new SW build is
// available) can land while a query is in exactly that state: hydrate() then has nothing on disk
// to restore it with, so the section boots data-less and the immediate refetch fails too (backend
// still down) -- rendering blank until real connectivity returns, even though nothing was ever
// actually lost server-side. Persisting on `data` presence instead of last-attempt status closes
// that gap.
export function shouldDehydrateQuery(query) {
  return query.state.status === 'success' || query.state.data !== undefined;
}

export const persistOptions = {
  persister: queryPersister,
  maxAge: ONE_DAY,
  buster: QUERY_CACHE_BUSTER,
  // Queries ONLY. Unsynced writes are NOT persisted here -- they live in the separate durable
  // outbox (lib/outboxPersistence.js), which has no maxAge and no buster, so a >24h offline gap or
  // an app update (which changes the buster and discards this cache) can never drop a queued write.
  dehydrateOptions: {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery,
  },
};

// Called on every auth transition (login success + logout). The exercise catalog and tag
// vocabulary are keyed WITHOUT an accountId, so without this a second household logging in on
// the same device could read the first household's cached catalog. Clearing both the live cache
// and the persisted copy on any auth change makes cross-account bleed impossible.
//
// QUERIES only -- deliberately does not touch the mutation cache (queryClient.clear() used to,
// which is what silently wiped the durable outbox on every login/401 before this fix). The outbox
// has its own account-scoped isolation (see outboxPersistence.js's adoptOutboxAccount usage in
// AuthContext), so it doesn't need this blunt clear-everything approach to stay safe.
export function resetQueryCache() {
  queryClient.getQueryCache().clear();
  queryPersister.removeClient();
}
