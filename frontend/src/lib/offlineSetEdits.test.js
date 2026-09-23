import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelQueuedWritesForSet, deleteQueuedSet, patchPendingLogSetDisplay } from './offlineSetEdits';
import {
  DELETE_SET_MUTATION_KEY,
  EDIT_SET_MUTATION_KEY,
  LOG_SET_MUTATION_KEY,
  isDeleteQueuedFor,
  registerOfflineMutationDefaults,
} from './queryClient';
import { clearSetIdMap } from './setIdMap';
import { deleteSet, editSet, logLiveSet } from '../api/sets';

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

  // The Remove-mid-save bug (docs/incidents/2026-09-23-remove-mid-save-deleted-nothing.md):
  // cancelling a create only takes it out of the cache, so one whose request may already be on the
  // wire has to be deleted for real instead -- by a DELETE_SET queued behind it, against its tempId.
  describe('deleteQueuedSet', () => {
    const DELETE_VARS = { personId: 7, exerciseId: 1, sessionId: null };

    function queuedDeletes(client) {
      return client.getMutationCache().getAll().filter((m) => m.options.mutationKey?.[0] === DELETE_SET_MUTATION_KEY[0]);
    }

    beforeEach(() => clearSetIdMap());

    it('cancels a create that never left the device, queuing nothing', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client);
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(1));

      deleteQueuedSet(client, 'optimistic-a', DELETE_VARS);

      expect(client.getMutationCache().getAll()).toHaveLength(0);
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      expect(logLiveSet).not.toHaveBeenCalled();
      expect(deleteSet).not.toHaveBeenCalled();
    });

    // THE BUG. The create is in flight when the person deletes it: cancelling cannot stop it
    // landing, so the delete must run after it, against the id it lands with.
    it('queues a real delete behind a create that is already in flight, resolving its id once it lands', async () => {
      const client = newClient();
      let land;
      logLiveSet.mockReturnValueOnce(new Promise((resolve) => { land = resolve; }));
      deleteSet.mockResolvedValue(null);
      dispatchLogSet(client);
      await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalledTimes(1));

      deleteQueuedSet(client, 'optimistic-a', DELETE_VARS);

      // The create is left alone -- it is what records the id the delete needs.
      expect(pendingMutations(client).map((m) => m.options.mutationKey[0])).toEqual(['logSet', 'deleteSet']);
      expect(isDeleteQueuedFor(client, 'optimistic-a')).toBe(true);
      expect(deleteSet).not.toHaveBeenCalled();

      land({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });

      await vi.waitFor(() => expect(deleteSet).toHaveBeenCalledWith(201));
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(0));
    });

    // Restored from a page that may already have sent it -- restoreOutbox's stamp. Paused offline
    // with a fresh failureCount it looks never-sent by state alone, which is exactly why the stamp exists.
    it('queues a real delete for a paused create restored as possibly sent', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client, { mayHaveBeenSent: true });
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(1));

      deleteQueuedSet(client, 'optimistic-a', DELETE_VARS);

      expect(queuedDeletes(client)).toHaveLength(1);
      expect(queuedDeletes(client)[0].state.variables).toMatchObject({ setId: 'optimistic-a', personId: 7 });
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      await vi.waitFor(() => expect(deleteSet).toHaveBeenCalledWith(201));
    });

    // The server answered with a definitive refusal, so nothing was stored -- and a delete queued
    // behind it could only die with it, sitting in the outbox as a write that "couldn't sync".
    it('cancels a create the server definitively refused', async () => {
      const client = newClient();
      logLiveSet.mockRejectedValueOnce(Object.assign(new Error('Bad request'), { status: 400 }));
      dispatchLogSet(client);
      await vi.waitFor(() => expect(client.getMutationCache().getAll()[0].state.status).toBe('error'));

      deleteQueuedSet(client, 'optimistic-a', DELETE_VARS);

      expect(client.getMutationCache().getAll()).toHaveLength(0);
    });

    it('deletes by real id when the create already landed and left the cache', async () => {
      const client = newClient();
      deleteSet.mockResolvedValue(null);
      dispatchLogSet(client);
      await vi.waitFor(() => expect(client.getMutationCache().getAll()[0].state.status).toBe('success'));
      client.getMutationCache().clear();

      deleteQueuedSet(client, 'optimistic-a', DELETE_VARS);

      await vi.waitFor(() => expect(deleteSet).toHaveBeenCalledWith(201));
    });
  });
});
