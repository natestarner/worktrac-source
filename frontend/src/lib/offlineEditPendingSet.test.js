// Integration coverage for editing a not-yet-synced set: the edit is a genuinely separate durable
// EDIT_SET write targeting the create's tempId (see offlineSetEdits.js's redesign away from
// mutating the queued create in place), so on reconnect the create keeps its scope position (no
// reordering) and the edit resolves to the real id and lands as a real, distinct write -- even if
// the create had already reached the server before the edit synced (the scenario that used to let
// the backend's idempotency dedup silently discard the edit -- see WorkoutSetService.findDuplicate).
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EDIT_SET_MUTATION_KEY,
  LOG_SET_MUTATION_KEY,
  registerOfflineMutationDefaults,
} from './queryClient';
import { clearSetIdMap, setSetIdMapping } from './setIdMap';
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

function dispatch(client, mutationKey, variables) {
  const observer = new MutationObserver(client, { ...client.getMutationDefaults(mutationKey), mutationKey });
  observer.mutate(variables).catch(() => {});
}

describe('editing a not-yet-synced set', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearSetIdMap();
    onlineManager.setOnline(true);
  });
  afterEach(async () => {
    onlineManager.setOnline(true);
    await clearSetIdMap();
  });

  it('does not reorder the queued create -- it still replays before a set logged after it, and the edit resolves and lands last', async () => {
    const client = newClient();
    logLiveSet
      .mockResolvedValueOnce({ isPR: false, best: null, session: { id: 9 }, set: { id: 100 } })
      .mockResolvedValueOnce({ isPR: false, best: null, session: { id: 9 }, set: { id: 101 } });
    editSet.mockResolvedValue({ id: 100, weight: 145, reps: 3 });

    onlineManager.setOnline(false);
    // Set A logged, then edited (queues a durable EDIT_SET against A's tempId -- not a mutation of
    // A's own queued create), then Set B logged after the edit.
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 3, weight: 135, reps: 5,
      tempId: 'optimistic-a', idempotencyKey: 'a-key', clientLoggedAt: 't1',
    });
    dispatch(client, EDIT_SET_MUTATION_KEY, {
      setId: 'optimistic-a', weight: 145, reps: 3, personId: 7, sessionId: null, exerciseId: 3, exerciseName: 'Squat',
    });
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 3, weight: 185, reps: 5,
      tempId: 'optimistic-b', idempotencyKey: 'b-key', clientLoggedAt: 't2',
    });

    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(3),
    );

    onlineManager.setOnline(true);
    await client.resumePausedMutations();

    // Both creates land, in true enqueue order, with their ORIGINAL values -- editing A never
    // touched A's queued create, so B (logged after the edit) still replays after A, not ahead of
    // it, and A's create still commits what was actually logged.
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalledTimes(2));
    expect(logLiveSet).toHaveBeenNthCalledWith(1, 7, expect.objectContaining({ weight: 135, reps: 5, idempotencyKey: 'a-key' }));
    expect(logLiveSet).toHaveBeenNthCalledWith(2, 7, expect.objectContaining({ weight: 185, reps: 5, idempotencyKey: 'b-key' }));
    // The edit resolves against A's real id (100, mapped by A's own onSettled once it synced) and
    // applies as a real, separate write.
    await vi.waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(editSet).toHaveBeenCalledWith(100, { weight: 145, reps: 3 });
  });

  it("does not lose the edit when the set's create had already reached the server before the edit synced (the silent-drop this redesign fixes)", async () => {
    const client = newClient();
    // Simulate: the create already committed server-side and its onSettled already recorded the
    // temp->real mapping -- e.g. lie-fi where the response was lost but the insert had gone through.
    setSetIdMapping('optimistic-a', 500);
    editSet.mockResolvedValue({ id: 500, weight: 145, reps: 3 });

    dispatch(client, EDIT_SET_MUTATION_KEY, {
      setId: 'optimistic-a', weight: 145, reps: 3, personId: 7, sessionId: null, exerciseId: 3, exerciseName: 'Squat',
    });

    await vi.waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    // A REAL edit call against the real id -- never a re-dispatched create under the same
    // idempotencyKey, which the backend's findDuplicate would have silently discarded in favor of
    // the already-committed (pre-edit) row.
    expect(editSet).toHaveBeenCalledWith(500, { weight: 145, reps: 3 });
    expect(logLiveSet).not.toHaveBeenCalled();
  });
});
