// A real (in-memory) IndexedDB so the outbox's actual persist/restore path is exercised, not no-oped.
// Imported first so `indexedDB` is defined before the modules under test read `typeof indexedDB`.
import 'fake-indexeddb/auto';
import { get } from 'idb-keyval';
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachOutboxPersistence,
  clearOutbox,
  persistOutboxNow,
  restoreOutbox,
} from './outboxPersistence';
import { LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from './queryClient';
import { logLiveSet } from '../api/sets';

vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
  listSessionSets: vi.fn(),
}));

const OUTBOX_KEY = 'worktrac-outbox';

function newClient() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerOfflineMutationDefaults(client, { retry: false });
  return client;
}

// Fire a log-set mutation through the registered defaults (so it carries the outbox scope + fn).
function dispatchLogSet(client, variables) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer.mutate(variables).catch(() => {});
  return observer;
}

function liveSetVars(overrides = {}) {
  return {
    mode: 'live',
    personId: 7,
    sessionId: null,
    exerciseId: 1,
    unit: 'lb',
    weight: 135,
    reps: 8,
    tempId: `optimistic-${Math.random()}`,
    idempotencyKey: `key-${Math.random()}`,
    clientLoggedAt: '2026-07-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('offline outbox persistence', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    await clearOutbox();
    onlineManager.setOnline(true);
  });

  afterEach(() => onlineManager.setOnline(true));

  it('persists a queued (offline-paused) write and replays it on a fresh client after restore (hardening #1)', async () => {
    const client1 = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client1, liveSetVars({ idempotencyKey: 'idem-1' }));
    await vi.waitFor(() =>
      expect(client1.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );

    await persistOutboxNow(client1);
    const stored = await get(OUTBOX_KEY);
    expect(stored.mutations).toHaveLength(1);

    // Simulate an app restart: a brand-new client restores the outbox from IndexedDB and replays.
    const client2 = newClient();
    await restoreOutbox(client2);
    expect(client2.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1);

    onlineManager.setOnline(true);
    await client2.resumePausedMutations();

    expect(logLiveSet).toHaveBeenCalledTimes(1);
    expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ exerciseId: 1, idempotencyKey: 'idem-1' }));
  });

  it('replays queued writes strictly in enqueue order (hardening #2)', async () => {
    const client1 = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client1, liveSetVars({ reps: 5, idempotencyKey: 'first' }));
    dispatchLogSet(client1, liveSetVars({ reps: 6, idempotencyKey: 'second' }));
    await vi.waitFor(() =>
      expect(client1.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(2),
    );
    await persistOutboxNow(client1);

    const client2 = newClient();
    await restoreOutbox(client2);
    onlineManager.setOnline(true);
    await client2.resumePausedMutations();

    const keysInOrder = logLiveSet.mock.calls.map(([, payload]) => payload.idempotencyKey);
    expect(keysInOrder).toEqual(['first', 'second']);
  });

  it('eagerly persists on enqueue via the mutation-cache subscription (hardening #6)', async () => {
    const client = newClient();
    const detach = attachOutboxPersistence(client);
    onlineManager.setOnline(false);
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'eager' }));

    // No explicit persist call -- the subscription must have written it as soon as it paused.
    await vi.waitFor(async () => {
      const stored = await get(OUTBOX_KEY);
      expect(stored?.mutations).toHaveLength(1);
    });
    detach();
  });

  it('does NOT persist a paused mutation that lacks the outbox scope (un-replayable writes are skipped)', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    // A plain mutation with no registered defaults / no outbox scope.
    const observer = new MutationObserver(client, { mutationFn: vi.fn(), mutationKey: ['somethingElse'] });
    observer.mutate({}).catch(() => {});
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );

    await persistOutboxNow(client);
    const stored = await get(OUTBOX_KEY);
    expect(stored).toBeUndefined(); // nothing durable to persist -> key cleared
  });
});
