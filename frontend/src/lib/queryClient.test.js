import 'fake-indexeddb/auto';
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOG_SET_MUTATION_KEY,
  clearOutboxMutations,
  flushOutbox,
  queryClient,
  registerOfflineMutationDefaults,
  resetQueryCache,
  shouldRetryWrite,
} from './queryClient';
import { clearExerciseIdMap, newTempExerciseId, setExerciseIdMapping } from './exerciseIdMap';
import { logLiveSet, logSetIntoSession } from '../api/sets';

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
  });

  afterEach(() => {
    // Drop everything WITHOUT resuming/settling it -- resuming would fire a real request in jsdom.
    queryClient.getMutationCache().clear();
    queryClient.getQueryCache().clear();
    onlineManager.setOnline(true);
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
});
