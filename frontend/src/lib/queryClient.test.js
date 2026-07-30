import 'fake-indexeddb/auto';
import { MutationObserver, QueryClient, dehydrate, hydrate, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOG_SET_MUTATION_KEY,
  clearOutboxMutations,
  flushOutbox,
  persistOptions,
  queryClient,
  registerOfflineMutationDefaults,
  resetQueryCache,
  shouldDehydrateQuery,
  shouldRetryWrite,
} from './queryClient';
import { clearExerciseIdMap, newTempExerciseId, setExerciseIdMapping } from './exerciseIdMap';
import { logLiveSet, logSetIntoSession } from '../api/sets';
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

  it('flushOutbox preserves the original submittedAt of a restarted stuck write, for correct ordering on a later restore', async () => {
    logLiveSet.mockRejectedValueOnce({ status: 500 });
    dispatchOnSingleton(
      { mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'stuck-submitted-at', clientLoggedAt: 't' },
      { retry: false },
    );
    await vi.waitFor(() => {
      const [mutation] = queryClient.getMutationCache().getAll();
      expect(mutation.state.status).toBe('error');
    });
    const originalSubmittedAt = queryClient.getMutationCache().getAll()[0].state.submittedAt;

    // Fake timers only from here -- the dispatch/error above already settled via microtasks
    // (retry: false), so real timers are fine for that `vi.waitFor`; this is just to make "time
    // actually passed before the restart" observable instead of a same-millisecond fluke.
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(60_000);
      logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
      await flushOutbox();

      const [restarted] = queryClient.getMutationCache().getAll();
      expect(restarted.state.submittedAt).toBe(originalSubmittedAt);
    } finally {
      vi.useRealTimers();
    }
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
