// A real (in-memory) IndexedDB so the outbox's actual persist/restore path is exercised, not no-oped.
// Imported first so `indexedDB` is defined before the modules under test read `typeof indexedDB`.
import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachOutboxPersistence,
  clearOutbox,
  getOutboxAccountId,
  persistOutboxNow,
  restoreOutbox,
  setOutboxAccountId,
  __resetOutboxAccountForTests,
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

const ACCOUNT = 'acct-1';
const LEGACY_OUTBOX_KEY = 'worktrac-outbox';

function keyFor(accountId) {
  return `worktrac-outbox:${accountId}`;
}

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
    await clearOutbox(ACCOUNT);
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    __resetOutboxAccountForTests();
  });

  it('persists a queued (offline-paused) write and replays it on a fresh client after restore', async () => {
    const client1 = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client1, liveSetVars({ idempotencyKey: 'idem-1' }));
    await vi.waitFor(() =>
      expect(client1.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );

    await persistOutboxNow(client1, ACCOUNT);
    const stored = await get(keyFor(ACCOUNT));
    expect(stored.mutations).toHaveLength(1);

    // Simulate an app restart: a brand-new client restores the outbox from IndexedDB and replays.
    const client2 = newClient();
    await restoreOutbox(client2, ACCOUNT);
    expect(client2.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1);

    onlineManager.setOnline(true);
    await client2.resumePausedMutations();

    expect(logLiveSet).toHaveBeenCalledTimes(1);
    expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ exerciseId: 1, idempotencyKey: 'idem-1' }));
  });

  it('replays queued writes strictly in enqueue order', async () => {
    const client1 = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client1, liveSetVars({ reps: 5, idempotencyKey: 'first' }));
    dispatchLogSet(client1, liveSetVars({ reps: 6, idempotencyKey: 'second' }));
    await vi.waitFor(() =>
      expect(client1.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(2),
    );
    await persistOutboxNow(client1, ACCOUNT);

    const client2 = newClient();
    await restoreOutbox(client2, ACCOUNT);
    onlineManager.setOnline(true);
    await client2.resumePausedMutations();

    const keysInOrder = logLiveSet.mock.calls.map(([, payload]) => payload.idempotencyKey);
    expect(keysInOrder).toEqual(['first', 'second']);
  });

  it('eagerly persists on enqueue via the mutation-cache subscription', async () => {
    const client = newClient();
    const detach = attachOutboxPersistence(client, ACCOUNT);
    onlineManager.setOnline(false);
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'eager' }));

    // No explicit persist call -- the subscription must have written it as soon as it paused.
    await vi.waitFor(async () => {
      const stored = await get(keyFor(ACCOUNT));
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

    await persistOutboxNow(client, ACCOUNT);
    const stored = await get(keyFor(ACCOUNT));
    expect(stored).toBeUndefined(); // nothing durable to persist -> key cleared
  });

  it('persists a write that is actively retrying online (pending, not paused) -- not just paused ones', async () => {
    const client = newClient();
    logLiveSet.mockReturnValue(new Promise(() => {})); // never resolves -- stays pending, online
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'mid-retry' }));
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalled());

    const [mutation] = client.getMutationCache().getAll();
    expect(mutation.state.isPaused).toBe(false);
    expect(mutation.state.status).toBe('pending');

    await persistOutboxNow(client, ACCOUNT);
    const stored = await get(keyFor(ACCOUNT));
    expect(stored.mutations).toHaveLength(1);
    expect(stored.mutations[0].state.status).toBe('pending');
  });

  it('persists a write that terminal-errored, and restore re-dispatches it from its variables (not hydrated as inert history)', async () => {
    const client = newClient(); // retry: false
    logLiveSet.mockRejectedValueOnce({ status: 500 });
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'errored' }));
    await vi.waitFor(() => {
      const [mutation] = client.getMutationCache().getAll();
      expect(mutation.state.status).toBe('error');
    });

    await persistOutboxNow(client, ACCOUNT);
    const stored = await get(keyFor(ACCOUNT));
    expect(stored.mutations).toHaveLength(1);
    expect(stored.mutations[0].state.status).toBe('error');

    // A fresh client (simulating a reload) restores it -- since it wasn't paused, there's no
    // "resume" for it; restoreOutbox must re-dispatch it fresh instead.
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    const client2 = newClient();
    await restoreOutbox(client2, ACCOUNT);

    await vi.waitFor(() =>
      expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ idempotencyKey: 'errored' })),
    );
  });

  it('keeps each account\'s outbox in its own key -- one account\'s writes never restore under another', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'account-a-only' }));
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );
    await persistOutboxNow(client, 'account-a');

    const client2 = newClient();
    await restoreOutbox(client2, 'account-b');
    expect(client2.getMutationCache().getAll()).toHaveLength(0);

    // Account A's own data is untouched and still restorable.
    const client3 = newClient();
    await restoreOutbox(client3, 'account-a');
    expect(client3.getMutationCache().getAll()).toHaveLength(1);
  });

  it('migrates the old single global outbox key into a per-account key once, on first restore', async () => {
    onlineManager.setOnline(false);
    const client = newClient();
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'legacy' }));
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );
    // Simulate data left over from before per-account keys existed, under the bare legacy key.
    const dehydrated = await (async () => {
      await persistOutboxNow(client, 'temp');
      const data = await get(keyFor('temp'));
      await clearOutbox('temp');
      return data;
    })();
    await set(LEGACY_OUTBOX_KEY, dehydrated);

    const freshClient = newClient();
    await restoreOutbox(freshClient, 'acct-migrated');

    expect(freshClient.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1);
    expect(await get(LEGACY_OUTBOX_KEY)).toBeUndefined();
    expect(await get(keyFor('acct-migrated'))).toBeDefined();
  });

  it('the outbox account pointer round-trips through localStorage', () => {
    expect(getOutboxAccountId()).toBeNull();
    setOutboxAccountId(42);
    expect(getOutboxAccountId()).toBe('42');
    __resetOutboxAccountForTests();
    expect(getOutboxAccountId()).toBeNull();
  });
});
