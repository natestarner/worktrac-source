import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasInFlightWrite } from './pendingWrites';
import { EDIT_SET_MUTATION_KEY, LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from './queryClient';
import { logLiveSet, editSet } from '../api/sets';

vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
}));

function newClient() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerOfflineMutationDefaults(client, { retry: false });
  return client;
}

function dispatch(client, mutationKey, variables) {
  const observer = new MutationObserver(client, { ...client.getMutationDefaults(mutationKey), mutationKey });
  observer.mutate(variables).catch(() => {});
  return observer;
}

describe('hasInFlightWrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
  });

  afterEach(() => onlineManager.setOnline(true));

  it('is false with nothing pending', () => {
    expect(hasInFlightWrite(newClient(), 7)).toBe(false);
  });

  it('is false for a personId of null/undefined (nothing to protect)', () => {
    const client = newClient();
    logLiveSet.mockReturnValue(new Promise(() => {}));
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, unit: 'lb', idempotencyKey: 'a', clientLoggedAt: 't', tempId: 'temp-a',
    });
    expect(hasInFlightWrite(client, null)).toBe(false);
    expect(hasInFlightWrite(client, undefined)).toBe(false);
  });

  it('is true for an ONLINE in-flight (not yet paused) write for that person', () => {
    const client = newClient();
    logLiveSet.mockReturnValue(new Promise(() => {})); // never resolves -- stays "pending", online
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, unit: 'lb', idempotencyKey: 'b', clientLoggedAt: 't', tempId: 'temp-b',
    });

    expect(hasInFlightWrite(client, 7)).toBe(true);
  });

  it('is false for a PAUSED (offline) write -- that one is already durable', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, unit: 'lb', idempotencyKey: 'c', clientLoggedAt: 't', tempId: 'temp-c',
    });
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );

    expect(hasInFlightWrite(client, 7)).toBe(false);
  });

  it('is false once the in-flight write settles', async () => {
    const client = newClient();
    let resolveLog;
    logLiveSet.mockImplementation(() => new Promise((resolve) => { resolveLog = resolve; }));
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, unit: 'lb', idempotencyKey: 'd', clientLoggedAt: 't', tempId: 'temp-d',
    });
    expect(hasInFlightWrite(client, 7)).toBe(true);

    // mutate() flips status to 'pending' synchronously, but the mutationFn itself (and thus the
    // capture of resolveLog) only runs on a later microtask -- wait for it before resolving.
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    resolveLog({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    await vi.waitFor(() => expect(hasInFlightWrite(client, 7)).toBe(false));
  });

  it('is false for a different person\'s in-flight write', () => {
    const client = newClient();
    logLiveSet.mockReturnValue(new Promise(() => {}));
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 8, exerciseId: 1, weight: 100, reps: 5, unit: 'lb', idempotencyKey: 'e', clientLoggedAt: 't', tempId: 'temp-e',
    });

    expect(hasInFlightWrite(client, 7)).toBe(false);
    expect(hasInFlightWrite(client, 8)).toBe(true);
  });

  it('checks across mutation kinds, not just logSet', () => {
    const client = newClient();
    editSet.mockReturnValue(new Promise(() => {}));
    dispatch(client, EDIT_SET_MUTATION_KEY, { setId: 55, weight: 140, reps: 5, personId: 7, sessionId: 101, exerciseId: 1 });

    expect(hasInFlightWrite(client, 7)).toBe(true);
  });
});
