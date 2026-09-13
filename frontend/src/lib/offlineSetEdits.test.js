import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelQueuedWritesForSet, patchPendingLogSetDisplay } from './offlineSetEdits';
import { EDIT_SET_MUTATION_KEY, LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from './queryClient';
import { editSet, logLiveSet } from '../api/sets';

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

function dispatchLogSet(client, overrides = {}) {
  const vars = {
    mode: 'live',
    personId: 7,
    sessionId: null,
    exerciseId: 1,
    unit: 'lb',
    weight: 135,
    reps: 5,
    tempId: 'optimistic-a',
    idempotencyKey: 'idem-a',
    clientLoggedAt: '2026-07-22T10:00:00.000Z',
    ...overrides,
  };
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer.mutate(vars).catch(() => {});
  return vars;
}

function dispatchEditSet(client, setId) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(EDIT_SET_MUTATION_KEY),
    mutationKey: EDIT_SET_MUTATION_KEY,
  });
  observer.mutate({ setId, weight: 140, reps: 3, personId: 7, sessionId: null, exerciseId: 1 }).catch(() => {});
}

function pendingMutations(client) {
  return client.getMutationCache().getAll().filter((m) => m.state.status === 'pending');
}

describe('offlineSetEdits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    onlineManager.setOnline(true);
  });

  afterEach(() => onlineManager.setOnline(true));

  describe('cancelQueuedWritesForSet', () => {
    it('removes the paused mutation behind an offline-logged set', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client);
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(1));

      cancelQueuedWritesForSet(client, 'optimistic-a');

      expect(pendingMutations(client)).toHaveLength(0);
      // Cancelled outright -- never actually dispatched to the server, even after reconnect.
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      expect(logLiveSet).not.toHaveBeenCalled();
    });

    it('is a no-op when no mutation matches the tempId', () => {
      const client = newClient();
      expect(() => cancelQueuedWritesForSet(client, 'no-such-temp-id')).not.toThrow();
    });

    // The reported bug: edit a not-yet-synced set, then delete it. Cancelling only the create left
    // the EDIT_SET behind, pointing at a tempId nothing would ever map -- and that write then
    // retried forever, holding the one serial outbox scope and stopping every write behind it.
    it('takes a queued edit of that same unsynced set with it', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client);
      dispatchEditSet(client, 'optimistic-a');
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(2));

      cancelQueuedWritesForSet(client, 'optimistic-a');

      expect(pendingMutations(client)).toHaveLength(0);
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      expect(logLiveSet).not.toHaveBeenCalled();
      expect(editSet).not.toHaveBeenCalled();
    });

    // Scoped to the set being deleted -- deleting one unsynced set must not silently discard a
    // correction to a different one.
    it('leaves a queued edit of a DIFFERENT set alone', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client);
      dispatchEditSet(client, 'optimistic-b');
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(2));

      cancelQueuedWritesForSet(client, 'optimistic-a');

      const left = pendingMutations(client);
      expect(left).toHaveLength(1);
      expect(left[0].options.mutationKey[0]).toBe('editSet');
      expect(left[0].state.variables.setId).toBe('optimistic-b');
    });
  });

  // patchPendingLogSetDisplay is display-only: it never touches what the queued CREATE sends to
  // the server (the correction is a genuinely separate EDIT_SET write -- see queryClient.js and
  // EditSetModal.jsx). These tests cover exactly that split: the display updates immediately, the
  // create's own wire payload does not, and -- the actual regression this whole redesign fixes --
  // the create is never removed or re-registered, so it can't be pushed out of its true enqueue
  // order in the shared outbox scope the way the old replacePendingLogSet approach could.
  describe('patchPendingLogSetDisplay', () => {
    it("updates the pending create's displayed variables without changing what it sends to the server", async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client, { weight: 135, reps: 5 });
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(1));

      patchPendingLogSetDisplay(client, 'optimistic-a', { weight: 140, reps: 3 });

      const [mutation] = pendingMutations(client);
      expect(mutation.state.variables).toMatchObject({ weight: 140, reps: 3, idempotencyKey: 'idem-a', tempId: 'optimistic-a' });

      // The CREATE still commits the ORIGINAL values once it syncs -- by design. The correction
      // reaches the server via a separately-queued EDIT_SET write, not by changing this payload.
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalledTimes(1));
      expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ weight: 135, reps: 5 }));
    });

    it('does not remove or reorder the pending create -- same object, same scope position', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client);
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(1));
      const [before] = pendingMutations(client);

      patchPendingLogSetDisplay(client, 'optimistic-a', { weight: 140, reps: 3 });

      const [after] = pendingMutations(client);
      expect(after).toBe(before); // same Mutation instance -- its scope-array slot never moved
    });

    it('preserves the original submittedAt (never touched, since nothing is removed/recreated)', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client);
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(1));
      const originalSubmittedAt = pendingMutations(client)[0].state.submittedAt;

      patchPendingLogSetDisplay(client, 'optimistic-a', { weight: 140, reps: 3 });

      expect(pendingMutations(client)[0].state.submittedAt).toBe(originalSubmittedAt);
    });

    it('notifies the mutation cache so a mounted useMutationState re-renders with the correction immediately', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client);
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(1));

      const listener = vi.fn();
      const unsubscribe = client.getMutationCache().subscribe(listener);
      listener.mockClear();

      patchPendingLogSetDisplay(client, 'optimistic-a', { weight: 140, reps: 3 });

      expect(listener).toHaveBeenCalled();
      unsubscribe();
    });

    it('is a no-op when no mutation matches the tempId (already synced or never existed)', () => {
      const client = newClient();
      expect(() => patchPendingLogSetDisplay(client, 'no-such-temp-id', { weight: 100, reps: 1 })).not.toThrow();
    });
  });
});
