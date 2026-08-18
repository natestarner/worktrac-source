import 'fake-indexeddb/auto';
import { MutationObserver, QueryClient, dehydrate, hydrate, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EDIT_SET_MUTATION_KEY,
  LOG_SET_MUTATION_KEY,
  clearOutboxMutations,
  flushOutbox,
  persistOptions,
  queryClient,
  registerOfflineMutationDefaults,
  resetQueryCache,
  shouldDehydrateQuery,
  isUnsyncedWrite,
  shouldRetryWrite,
} from './queryClient';
import { clearExerciseIdMap, newTempExerciseId, setExerciseIdMapping } from './exerciseIdMap';
import { _getMappingForTest, clearSetIdMap, setSetIdMapping } from './setIdMap';
import { markSessionEnded } from './endedSessions';
import { editSet, logLiveSet, logSetIntoSession } from '../api/sets';
import { queryKeys } from '../api/queryKeys';
import { setAuthToken } from '../api/client';

vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
  listSessionSets: vi.fn(),
}));

describe('shouldRetryWrite (failure taxonomy, hardening #8)', () => {
  it('does NOT retry a real 4xx (the server\'s definitive answer)', () => {
    expect(shouldRetryWrite(0, { status: 400 })).toBe(false);
    expect(shouldRetryWrite(0, { status: 404 })).toBe(false);
    expect(shouldRetryWrite(0, { status: 409 })).toBe(false);
  });

  // 408 and 429 sit inside the 4xx range but explicitly mean "try again" -- an intermediary that
  // gave up waiting on a cold-starting backend, and a rate limit that by definition expires.
  // Treating them as definitive drops a durable write forever, which is the exact failure the
  // "a connectivity problem can never lose a write" invariant exists to prevent.
  it('DOES retry the two retryable 4xx codes (408 timeout, 429 rate limit)', () => {
    expect(shouldRetryWrite(0, { status: 408 })).toBe(true);
    expect(shouldRetryWrite(0, { status: 429 })).toBe(true);
    expect(shouldRetryWrite(50, { status: 429 })).toBe(true);
  });

  // Guards the boundary: widening the carve-out to all of 4xx would head-of-line-block the shared
  // serial outbox scope forever on a write that can never succeed.
  it('still treats the 4xx codes either side of them as definitive', () => {
    expect(shouldRetryWrite(0, { status: 407 })).toBe(false);
    expect(shouldRetryWrite(0, { status: 409 })).toBe(false);
    expect(shouldRetryWrite(0, { status: 428 })).toBe(false);
    expect(shouldRetryWrite(0, { status: 430 })).toBe(false);
  });

  it('retries a 5xx / gateway error / cold-start 503 (server unreachable)', () => {
    expect(shouldRetryWrite(0, { status: 500 })).toBe(true);
    expect(shouldRetryWrite(0, { status: 503 })).toBe(true);
    expect(shouldRetryWrite(0, { status: 504 })).toBe(true);
  });

  it('retries a fetch reject with no status (offline/connection failure)', () => {
    expect(shouldRetryWrite(0, new TypeError('Failed to fetch'))).toBe(true);
  });

  it('never gives up on a transient failure, no matter how many attempts have failed', () => {
    expect(shouldRetryWrite(7, { status: 503 })).toBe(true);
    expect(shouldRetryWrite(8, { status: 503 })).toBe(true);
    expect(shouldRetryWrite(100, { status: 503 })).toBe(true);
    expect(shouldRetryWrite(100, new TypeError('Failed to fetch'))).toBe(true);
  });
});

describe('shouldDehydrateQuery (lie-fi persisted-cache gap)', () => {
  it('persists a query in the normal success state (unchanged default behavior)', () => {
    const query = { state: { status: 'success', data: ['a'] } };
    expect(shouldDehydrateQuery(query)).toBe(true);
  });

  it('still persists a query whose last background refetch failed, as long as it still has data -- the regression this closes', () => {
    const query = { state: { status: 'error', data: ['a', 'b'] } };
    expect(shouldDehydrateQuery(query)).toBe(true);
  });

  it('does not persist a query with no data yet (pending / never successfully fetched)', () => {
    const query = { state: { status: 'pending', data: undefined } };
    expect(shouldDehydrateQuery(query)).toBe(false);

    const erroredWithNoData = { state: { status: 'error', data: undefined } };
    expect(shouldDehydrateQuery(erroredWithNoData)).toBe(false);
  });

  it('end-to-end: a query with good data survives a dehydrate -> hydrate round trip on a fresh client even after a failed background refetch, using the app\'s real persistOptions', async () => {
    const client = new QueryClient();
    const key = ['history', 7];

    // A normal successful fetch while online.
    await client.fetchQuery({ queryKey: key, queryFn: () => Promise.resolve(['workout-A', 'workout-B']) });

    // Lie-fi: a background refetch (window focus / offline-cache-warm cycle) fires against the
    // now-unreachable backend and fails. Per TanStack's default reducer this flips status ->
    // 'error' but leaves `data` untouched in memory.
    await client
      .fetchQuery({ queryKey: key, queryFn: () => Promise.reject(new Error('Failed to fetch')), retry: false })
      .catch(() => {});
    expect(client.getQueryCache().find({ queryKey: key }).state.status).toBe('error');

    // A silent forced reload lands right now (swUpdate.js's tryForceUpdate, triggered by an
    // ordinary section/person switch): dehydrate what the persister would have written to
    // IndexedDB on its next throttled tick, then hydrate a brand-new client from it -- what boot
    // does on the next page load.
    const dehydrated = dehydrate(client, persistOptions.dehydrateOptions);
    const freshClientAfterReload = new QueryClient();
    hydrate(freshClientAfterReload, dehydrated);

    expect(freshClientAfterReload.getQueryData(key)).toEqual(['workout-A', 'workout-B']);
  });

  // Why offlineCacheWarm needs `refreshAfterRestore` (issue #146). Restoring preserves
  // dataUpdatedAt, so a rehydrated entry can be simultaneously WRONG (the persister's 1s throttle
  // never wrote the last change) and FRESH (its timestamp is seconds old). Freshness then
  // suppresses the very refetch that would repair it. This is a characterization test: it still
  // passes after the fix, because the fix is in the warm rather than in staleness itself.
  it('a restored entry is treated as fresh, so staleness alone will not repair a snapshot the persister missed', async () => {
    const key = queryKeys.routines(7);
    const appDefaults = { defaultOptions: queryClient.getDefaultOptions() };

    // offlineCacheWarm at login, before any routine exists.
    const client = new QueryClient(appDefaults);
    await client.fetchQuery({ queryKey: key, queryFn: () => Promise.resolve([]) });

    // The persister's throttled tick captures the empty list...
    const persistedBeforeCreate = dehydrate(client, persistOptions.dehydrateOptions);
    // ...then a routine is created, and a reload lands before the next tick.
    const afterReload = new QueryClient(appDefaults);
    hydrate(afterReload, persistedBeforeCreate);

    expect(afterReload.getQueryData(key)).toEqual([]);
    const restored = afterReload.getQueryCache().find({ queryKey: key });
    expect(restored.isStaleByTime(60 * 1000)).toBe(false); // fresh -> nothing refetches it
    expect(restored.isStaleByTime(0)).toBe(true); // control: the window really is time-bounded
  });
});

describe('registerOfflineMutationDefaults dispatches to the right endpoint', () => {
  let client;
  beforeEach(() => {
    vi.clearAllMocks();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    logSetIntoSession.mockResolvedValue({ isPR: false, best: null, session: { id: 2 }, set: { id: 2 } });
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    registerOfflineMutationDefaults(client, { retry: false });
  });

  function dispatch(variables) {
    const observer = new MutationObserver(client, {
      ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
      mutationKey: LOG_SET_MUTATION_KEY,
    });
    return observer.mutate(variables);
  }

  it('a live set posts to the person live-sets endpoint', async () => {
    await dispatch({ mode: 'live', personId: 7, exerciseId: 3, weight: 100, reps: 5, idempotencyKey: 'k1', clientLoggedAt: 't' });
    expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ exerciseId: 3, weight: 100, reps: 5, idempotencyKey: 'k1' }));
    expect(logSetIntoSession).not.toHaveBeenCalled();
  });

  it('a set logged into a specific session posts to the session endpoint', async () => {
    await dispatch({ mode: 'session', sessionId: 42, personId: 7, exerciseId: 3, weight: 100, reps: 5, idempotencyKey: 'k2', clientLoggedAt: 't' });
    expect(logSetIntoSession).toHaveBeenCalledWith(42, expect.objectContaining({ exerciseId: 3, idempotencyKey: 'k2' }));
    expect(logLiveSet).not.toHaveBeenCalled();
  });

  // Trends is derived entirely from logged sets, but was left out of this handler's invalidations
  // (which covered only prs/history). With staleTime at 60s that meant logging your first-ever set
  // and opening Trends still showed "No workouts logged yet" for a minute. Asserted against the
  // real cache rather than by spying on invalidateQueries, so it also proves the PREFIX keys match
  // the full ones -- a trends key carries a `weeks` the writer can't know.
  it('marks every cached trends range and exercise stale after a set is logged', async () => {
    const overview4 = queryKeys.trendsOverview(7, 4);
    const overview12 = queryKeys.trendsOverview(7, 12);
    const trendFor3 = queryKeys.exerciseTrend(7, 3, 12);
    const recordsFor3 = queryKeys.exerciseRecords(7, 3);
    const otherPerson = queryKeys.trendsOverview(99, 12);

    for (const key of [overview4, overview12, trendFor3, recordsFor3, otherPerson]) {
      client.setQueryData(key, { stub: true });
    }
    const isStale = (key) => client.getQueryState(key).isInvalidated;

    await dispatch({ mode: 'live', personId: 7, exerciseId: 3, weight: 100, reps: 5, idempotencyKey: 'k3', clientLoggedAt: 't' });

    expect(isStale(overview4)).toBe(true);
    expect(isStale(overview12)).toBe(true);
    expect(isStale(trendFor3)).toBe(true);
    expect(isStale(recordsFor3)).toBe(true);
    // Person scoping still holds -- one person's set must not invalidate another's trends.
    expect(isStale(otherPerson)).toBe(false);
  });
});

describe('dependent writes guard against an unresolved temp exercise id', () => {
  let client;
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearExerciseIdMap();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    registerOfflineMutationDefaults(client, { retry: false });
  });
  afterEach(async () => {
    await clearExerciseIdMap();
  });

  function dispatch(variables) {
    const observer = new MutationObserver(client, {
      ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
      mutationKey: LOG_SET_MUTATION_KEY,
    });
    return observer.mutate(variables);
  }

  it('throws a status-less (retryable) error instead of posting a raw temp id, and never calls the API', async () => {
    const tempId = newTempExerciseId();
    let caughtError;
    await dispatch({ mode: 'live', personId: 7, exerciseId: tempId, weight: 100, reps: 5, idempotencyKey: 'k3', clientLoggedAt: 't' }).catch(
      (error) => {
        caughtError = error;
      },
    );

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError.status).toBeUndefined();
    // shouldRetryWrite must treat this as transient (no `.status`), not as a definitive 4xx --
    // that's what makes it requeue/retry rather than surface as a stuck failure.
    expect(shouldRetryWrite(0, caughtError)).toBe(true);
    expect(logLiveSet).not.toHaveBeenCalled();
  });

  it('resolves and dispatches normally once the create has synced and mapped the id', async () => {
    const tempId = newTempExerciseId();
    setExerciseIdMapping(tempId, 555);

    await dispatch({ mode: 'live', personId: 7, exerciseId: tempId, weight: 100, reps: 5, idempotencyKey: 'k4', clientLoggedAt: 't' });

    expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ exerciseId: 555 }));
  });
});

// LOG_SET's onSettled recording the temp->real SET id mapping -- this is what lets an EDIT_SET
// queued against a still-syncing set's tempId resolve once the create lands (see the next describe
// block and offlineSetEdits.js's redesign away from mutating the queued create in place).
describe('logSet onSettled records the temp->real set id mapping', () => {
  let client;
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearSetIdMap();
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    registerOfflineMutationDefaults(client, { retry: false });
  });
  afterEach(async () => {
    await clearSetIdMap();
  });

  function dispatch(variables) {
    const observer = new MutationObserver(client, {
      ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
      mutationKey: LOG_SET_MUTATION_KEY,
    });
    return observer.mutate(variables);
  }

  it('maps tempId -> the real set id returned by the server on success', async () => {
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 4242 } });

    await dispatch({ mode: 'live', personId: 7, exerciseId: 3, weight: 100, reps: 5, tempId: 'optimistic-abc', idempotencyKey: 'k5', clientLoggedAt: 't' });

    expect(_getMappingForTest('optimistic-abc')).toBe(4242);
  });

  it('does not record a mapping when the write fails', async () => {
    logLiveSet.mockRejectedValueOnce({ status: 500 });

    await dispatch({ mode: 'live', personId: 7, exerciseId: 3, weight: 100, reps: 5, tempId: 'optimistic-def', idempotencyKey: 'k6', clientLoggedAt: 't' }).catch(() => {});

    expect(_getMappingForTest('optimistic-def')).toBeUndefined();
  });
});

describe('EDIT_SET guards against an unresolved temp set id (a set logged offline, not yet synced)', () => {
  let client;
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearSetIdMap();
    editSet.mockResolvedValue({ id: 1, weight: 140, reps: 3 });
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    registerOfflineMutationDefaults(client, { retry: false });
  });
  afterEach(async () => {
    await clearSetIdMap();
  });

  function dispatch(variables) {
    const observer = new MutationObserver(client, {
      ...client.getMutationDefaults(EDIT_SET_MUTATION_KEY),
      mutationKey: EDIT_SET_MUTATION_KEY,
    });
    return observer.mutate(variables);
  }

  it('throws a status-less (retryable) error instead of posting a raw temp id, and never calls the API', async () => {
    let caughtError;
    await dispatch({ setId: 'optimistic-not-synced-yet', weight: 140, reps: 3, personId: 7, sessionId: null, exerciseId: 3, exerciseName: 'Squat' }).catch((error) => {
      caughtError = error;
    });

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError.status).toBeUndefined();
    expect(shouldRetryWrite(0, caughtError)).toBe(true);
    expect(editSet).not.toHaveBeenCalled();
  });

  it('resolves and dispatches normally once the create has synced and mapped the id', async () => {
    setSetIdMapping('optimistic-now-synced', 4242);

    await dispatch({ setId: 'optimistic-now-synced', weight: 140, reps: 3, personId: 7, sessionId: null, exerciseId: 3, exerciseName: 'Squat' });

    expect(editSet).toHaveBeenCalledWith(4242, { weight: 140, reps: 3 });
  });

  it('a real numeric setId (an already-synced set) passes through unchanged', async () => {
    await dispatch({ setId: 999, weight: 140, reps: 3, personId: 7, sessionId: 10, exerciseId: 3, exerciseName: 'Squat' });

    expect(editSet).toHaveBeenCalledWith(999, { weight: 140, reps: 3 });
  });
});

// These three exercise the app's singleton client (its defaults are already registered at module
// load with the real shouldRetryWrite policy), the same way UserMenu.test.jsx does -- flushOutbox,
// clearOutboxMutations, and resetQueryCache all operate on that singleton, not a client parameter.
describe('flushOutbox / clearOutboxMutations / resetQueryCache (singleton client)', () => {
  function dispatchOnSingleton(variables, extraOptions = {}) {
    const observer = new MutationObserver(queryClient, {
      ...queryClient.getMutationDefaults(LOG_SET_MUTATION_KEY),
      mutationKey: LOG_SET_MUTATION_KEY,
      ...extraOptions,
    });
    observer.mutate(variables).catch(() => {});
    return observer;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    // flushOutbox is gated on an authenticated session (see queryClient.js) -- these tests are all
    // exercising the REPLAY mechanics assuming a logged-in user; the no-token gate itself is
    // covered separately below.
    setAuthToken('test-token');
  });

  afterEach(() => {
    // Drop everything WITHOUT resuming/settling it -- resuming would fire a real request in jsdom.
    queryClient.getMutationCache().clear();
    queryClient.getQueryCache().clear();
    onlineManager.setOnline(true);
    setAuthToken(null);
  });

  it('flushOutbox resumes paused (offline-queued) mutations', async () => {
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    onlineManager.setOnline(false);
    dispatchOnSingleton({ mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'flush-paused', clientLoggedAt: 't' });
    await vi.waitFor(() =>
      expect(queryClient.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );

    onlineManager.setOnline(true);
    await flushOutbox();

    expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ idempotencyKey: 'flush-paused' }));
  });

  it('flushOutbox re-dispatches a write stuck in a terminal error state (nothing left to resume on its own)', async () => {
    logLiveSet.mockRejectedValueOnce({ status: 500 }).mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    dispatchOnSingleton(
      { mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'flush-errored', clientLoggedAt: 't' },
      { retry: false },
    );
    await vi.waitFor(() => {
      const [mutation] = queryClient.getMutationCache().getAll();
      expect(mutation.state.status).toBe('error');
    });

    await flushOutbox();

    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalledTimes(2));
    expect(logLiveSet).toHaveBeenLastCalledWith(7, expect.objectContaining({ idempotencyKey: 'flush-errored' }));
  });

  // Regression test: flushOutbox used to restart a stuck write by removing it and dispatching a
  // brand-new mutation, which always registers at the END of the shared outbox scope's array --
  // the thing that actually governs replay order (TanStack's scope FIFO is registration order,
  // not submittedAt). That could let a write stuck behind a dependency (e.g. a log-set against a
  // not-yet-synced exercise) jump ahead of writes genuinely submitted later. Restarting the SAME
  // object in place (`m.execute(...)`) never changes its array position.
  it('flushOutbox restarts a stuck (terminal-error) mutation in place, without moving it in the shared scope', async () => {
    logLiveSet.mockRejectedValueOnce({ status: 500 });
    dispatchOnSingleton(
      { mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'stuck-in-place', clientLoggedAt: 't' },
      { retry: false },
    );
    await vi.waitFor(() => {
      const [mutation] = queryClient.getMutationCache().getAll();
      expect(mutation.state.status).toBe('error');
    });
    const [before] = queryClient.getMutationCache().getAll();

    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    await flushOutbox();

    const [after] = queryClient.getMutationCache().getAll();
    expect(after).toBe(before); // same object -- its scope-array slot never moved.
    await vi.waitFor(() => expect(after.state.status).toBe('success'));
  });

  // Was: "flushOutbox preserves the original submittedAt of a restarted stuck write, for correct
  // ordering on a later restore" -- that capture-and-restore dance is now deleted from flushOutbox
  // entirely (see the comment above it). The invariant a LATER restoreOutbox depends on is that
  // whatever ordering key a write carries survives a flushOutbox restart untouched -- previously
  // that required manually saving/restoring submittedAt around execute() (since execute() itself
  // re-stamps it); now it's true for free, because enqueueSeq lives in `variables`, which execute()
  // never touches at all.
  it('flushOutbox preserves enqueueSeq (the ordering key a later restore depends on) across a restart, with no special-case handling needed', async () => {
    logLiveSet.mockRejectedValueOnce({ status: 500 });
    dispatchOnSingleton(
      { mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'stuck-seq', clientLoggedAt: 't', enqueueSeq: 7 },
      { retry: false },
    );
    await vi.waitFor(() => {
      const [mutation] = queryClient.getMutationCache().getAll();
      expect(mutation.state.status).toBe('error');
    });

    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    await flushOutbox();

    const [restarted] = queryClient.getMutationCache().getAll();
    expect(restarted.state.variables.enqueueSeq).toBe(7);
    await vi.waitFor(() => expect(restarted.state.status).toBe('success'));
  });

  it('flushOutbox leaves a mid-retry (pending, not paused) write alone rather than double-firing it', async () => {
    logLiveSet.mockReturnValue(new Promise(() => {})); // never resolves -- stays pending
    dispatchOnSingleton({ mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'flush-pending', clientLoggedAt: 't' });
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalledTimes(1));

    await flushOutbox();

    expect(logLiveSet).toHaveBeenCalledTimes(1);
  });

  it('clearOutboxMutations evicts every outbox-scoped mutation from the live cache', async () => {
    onlineManager.setOnline(false);
    dispatchOnSingleton({ mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'clear-me', clientLoggedAt: 't' });
    await vi.waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(1));

    clearOutboxMutations();

    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('resetQueryCache clears the query cache but preserves queued outbox mutations (the regression this fixes)', async () => {
    onlineManager.setOnline(false);
    dispatchOnSingleton({ mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'survive-reset', clientLoggedAt: 't' });
    await vi.waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(1));
    queryClient.setQueryData(['some-query'], 'cached-value');

    resetQueryCache();

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    expect(queryClient.getMutationCache().getAll()[0].state.variables).toMatchObject({ idempotencyKey: 'survive-reset' });
  });

  // The login-loop bug: flushOutbox used to fire regardless of whether there was a session to
  // replay against. A queued write dispatched with no Authorization header 401s, and that 401 can
  // itself tear down a session that a moment later DOES have a valid token -- turning a handful of
  // stale queued writes into a bounce-to-/login loop. flushOutbox is the single choke point every
  // replay trigger (reconnect, boot restore, post-login, the offline banner's "Go back online")
  // funnels through, so gating it here closes the loop everywhere at once.
  describe('flushOutbox requires an authenticated session', () => {
    it('does nothing (no network call) when there is no auth token', async () => {
      logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
      onlineManager.setOnline(false);
      dispatchOnSingleton({ mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'no-token', clientLoggedAt: 't' });
      await vi.waitFor(() =>
        expect(queryClient.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
      );

      setAuthToken(null);
      onlineManager.setOnline(true);
      const resumed = await flushOutbox();

      expect(logLiveSet).not.toHaveBeenCalled();
      expect(resumed).toEqual([]);
      // Still paused -- nothing was resumed or dispatched, so nothing was lost either.
      expect(queryClient.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1);
    });

    it('replays normally once a token is present again', async () => {
      logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
      onlineManager.setOnline(false);
      dispatchOnSingleton({ mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'token-returns', clientLoggedAt: 't' });
      await vi.waitFor(() =>
        expect(queryClient.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
      );

      setAuthToken(null);
      onlineManager.setOnline(true);
      await flushOutbox();
      expect(logLiveSet).not.toHaveBeenCalled();

      setAuthToken('fresh-token');
      await flushOutbox();
      expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ idempotencyKey: 'token-returns' }));
    });
  });
});

// The display counterpart to shouldRetryWrite: which not-yet-synced writes a screen must keep
// showing. Shared by ExerciseDetail's row list and useSessionEntries' "Session exercises" list so
// the two can't drift -- they did, and a lie-fi write that exhausted its retries vanished from one
// while still showing on the other and still counting in the outbox badge.
describe('isUnsyncedWrite', () => {
  it('keeps a write paused offline', () => {
    expect(isUnsyncedWrite({ status: 'pending' })).toBe(true);
  });

  it('keeps a write whose retries have settled into a transient error', () => {
    // The lie-fi case: unreachable server, retries exhausted for now, but flushOutbox will restart
    // it on reconnect and shouldRetryWrite never gives up on a 5xx/statusless failure.
    expect(isUnsyncedWrite({ status: 'error', errorStatus: 503 })).toBe(true);
    expect(isUnsyncedWrite({ status: 'error', errorStatus: undefined })).toBe(true);
  });

  it('drops a write that landed', () => {
    expect(isUnsyncedWrite({ status: 'success' })).toBe(false);
  });

  it('drops a write the server definitively rejected', () => {
    // A real 4xx is the server's answer; onError has already rolled the optimistic row back.
    expect(isUnsyncedWrite({ status: 'error', errorStatus: 400 })).toBe(false);
    expect(isUnsyncedWrite({ status: 'error', errorStatus: 422 })).toBe(false);
  });

  it('agrees with shouldRetryWrite on where the 4xx boundary sits', () => {
    for (const status of [399, 400, 499, 500]) {
      const stillRetrying = shouldRetryWrite(1, { status });
      expect(isUnsyncedWrite({ status: 'error', errorStatus: status })).toBe(stillRetrying);
    }
  });
});


// The first set of a workout used to vanish for two sequential round trips: it left
// ExerciseDetail's pendingBeforeSession the instant the mutation reported success, while
// contextSessionId was still null and sessionSets had never been fetched under the just-created
// session's key. onSettled now reconciles straight from the response instead.
//
// The degraded-conditions block below is the load-bearing half of this suite: it proves the new
// writes are UNREACHABLE unless the server actually answered with a body.
describe('logSet onSettled reconciles from the response (first-set flash)', () => {
  let client;
  const PERSON = 7;
  const EXERCISE = 3;
  const SESSION = { id: 55, startedAt: '2026-08-17T10:00:00Z', endedAt: null, manual: false };
  const SET = { id: 4242, sessionId: 55, exerciseId: 3, weight: 100, reps: 5, durationSeconds: null, unit: 'lb', createdAt: 't', restSeconds: null };

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearSetIdMap();
    localStorage.clear();
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    registerOfflineMutationDefaults(client, { retry: false });
  });
  afterEach(async () => {
    await clearSetIdMap();
    localStorage.clear();
  });

  function dispatch(overrides = {}) {
    const observer = new MutationObserver(client, {
      ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
      mutationKey: LOG_SET_MUTATION_KEY,
    });
    return observer.mutate({
      mode: 'live', personId: PERSON, exerciseId: EXERCISE, weight: 100, reps: 5,
      tempId: 'optimistic-abc', idempotencyKey: 'k1', clientLoggedAt: 't', sessionId: null,
      ...overrides,
    });
  }

  it('promotes the real session from the response, so contextSessionId needs no round trip', async () => {
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: SESSION, set: SET });

    await dispatch();

    expect(client.getQueryData(queryKeys.liveSession(PERSON))).toEqual(SESSION);
  });

  it('seeds the confirmed row, carrying tempId so the row keeps one React key', async () => {
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: SESSION, set: SET });

    await dispatch();

    expect(client.getQueryData(queryKeys.sessionSets(55, EXERCISE))).toEqual([
      { ...SET, tempId: 'optimistic-abc' },
    ]);
  });

  // Sets 2+ (and session-edit mode) DO get an optimistic row from onMutate, keyed on the tempId.
  // Appending the confirmed row instead of replacing it would paint the same set twice.
  it('REPLACES an optimistic row in place rather than duplicating it', async () => {
    client.setQueryData(queryKeys.sessionSets(55, EXERCISE), [
      { id: 1, weight: 95, reps: 5 },
      { id: 'optimistic-abc', weight: 100, reps: 5, optimistic: true },
    ]);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: SESSION, set: SET });

    await dispatch();

    const rows = client.getQueryData(queryKeys.sessionSets(55, EXERCISE));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ ...SET, tempId: 'optimistic-abc' });
  });

  it('is a no-op when the server row is already present (a replay)', async () => {
    client.setQueryData(queryKeys.sessionSets(55, EXERCISE), [SET]);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: SESSION, set: SET });

    await dispatch();

    expect(client.getQueryData(queryKeys.sessionSets(55, EXERCISE))).toEqual([SET]);
  });

  // The same null -> real key flip cold-keyed the summary, dropping the cards to skeletons and
  // blinking the weight/reps steppers through an em dash (prefill derives from summary.lastSession).
  it('carries the summary across the null -> real session key', async () => {
    const summary = { lastSession: { sets: [{ weight: 95, reps: 5 }] }, best: { est1rm: 110 } };
    client.setQueryData(queryKeys.exerciseSummary(PERSON, EXERCISE, null), summary);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: SESSION, set: SET });

    await dispatch();

    expect(client.getQueryData(queryKeys.exerciseSummary(PERSON, EXERCISE, 55))).toEqual(summary);
  });

  it('never overwrites a summary already fetched under the real key', async () => {
    client.setQueryData(queryKeys.exerciseSummary(PERSON, EXERCISE, null), { lastSession: 'STALE', best: null });
    client.setQueryData(queryKeys.exerciseSummary(PERSON, EXERCISE, 55), { lastSession: 'REAL', best: null });
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: SESSION, set: SET });

    await dispatch();

    expect(client.getQueryData(queryKeys.exerciseSummary(PERSON, EXERCISE, 55))).toEqual({ lastSession: 'REAL', best: null });
  });

  // mode 'session' is "editing a specific PAST session" -- its response carries that session, which
  // is emphatically not this person's live session.
  it('does NOT promote a session in mode "session" (editing a past workout)', async () => {
    logSetIntoSession.mockResolvedValue({ isPR: false, best: null, session: { id: 999, startedAt: 'x' }, set: { ...SET, sessionId: 999 } });

    await dispatch({ mode: 'session', sessionId: 999 });

    expect(client.getQueryData(queryKeys.liveSession(PERSON))).toBeUndefined();
  });

  // A queued set replaying after End Workout must not resurrect the finished session into the cache.
  it('does NOT promote a session this device has already ended', async () => {
    markSessionEnded(PERSON, 55);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: SESSION, set: SET });

    await dispatch();

    expect(client.getQueryData(queryKeys.liveSession(PERSON))).toBeUndefined();
  });

  // ---- Degraded conditions: the whole block must be inert ------------------------------------
  // `data` is non-undefined only when the server returned a success body, so none of the writes
  // above can fire while offline (the mutation pauses and never settles), during lie-fi or on a
  // definitive 4xx (settles with data === undefined), or against a 5xx / cold start.
  // pendingBeforeSession stays the sole source of those rows, exactly as before this change.
  describe('is inert unless the server actually answered', () => {
    function expectNothingWritten() {
      expect(client.getQueryData(queryKeys.liveSession(PERSON))).toBeUndefined();
      expect(client.getQueryData(queryKeys.sessionSets(55, EXERCISE))).toBeUndefined();
      expect(client.getQueryData(queryKeys.sessionSets(null, EXERCISE))).toBeUndefined();
      expect(client.getQueryData(queryKeys.exerciseSummary(PERSON, EXERCISE, 55))).toBeUndefined();
    }

    it('writes nothing on a statusless network rejection (lie-fi, retries exhausted)', async () => {
      logLiveSet.mockRejectedValue(new TypeError('Failed to fetch'));
      await dispatch().catch(() => {});
      expectNothingWritten();
    });

    it('writes nothing on a 503 (DB down / backend cold start)', async () => {
      logLiveSet.mockRejectedValue({ status: 503 });
      await dispatch().catch(() => {});
      expectNothingWritten();
    });

    it('writes nothing on a definitive 4xx', async () => {
      logLiveSet.mockRejectedValue({ status: 400 });
      await dispatch().catch(() => {});
      expectNothingWritten();
    });

    it('writes nothing while paused offline -- the mutation never settles at all', async () => {
      const wasOnline = onlineManager.isOnline();
      onlineManager.setOnline(false);
      try {
        logLiveSet.mockResolvedValue({ isPR: false, best: null, session: SESSION, set: SET });
        dispatch().catch(() => {});
        await Promise.resolve();
        expect(logLiveSet).not.toHaveBeenCalled();
        expectNothingWritten();
      } finally {
        onlineManager.setOnline(wasOnline);
      }
    });

    // A response missing either half must not half-apply the reconciliation.
    it('writes nothing when the response carries no session (defensive)', async () => {
      logLiveSet.mockResolvedValue({ isPR: false, best: null, session: null, set: SET });
      await dispatch().catch(() => {});
      expect(client.getQueryData(queryKeys.liveSession(PERSON))).toBeUndefined();
      expect(client.getQueryData(queryKeys.sessionSets(null, EXERCISE))).toBeUndefined();
    });
  });
});
