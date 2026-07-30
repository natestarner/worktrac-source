// The headline PR 4 guarantee: create an exercise AND log a set against it while fully offline, then
// on reconnect the create replays FIRST and the set replays against the REAL server id -- never lost,
// never orphaned against a temp id.
import 'fake-indexeddb/auto';
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREATE_EXERCISE_MUTATION_KEY,
  LOG_SET_MUTATION_KEY,
  registerOfflineMutationDefaults,
} from './queryClient';
import { clearExerciseIdMap, newTempExerciseId } from './exerciseIdMap';
import { clearOutbox, persistOutboxNow, restoreOutbox } from './outboxPersistence';
import { addExercise, favoriteExercise } from '../api/exercises';
import { logLiveSet } from '../api/sets';
import { setAuthToken } from '../api/client';

vi.mock('../api/exercises', () => ({
  addExercise: vi.fn(),
  favoriteExercise: vi.fn(),
  updateExercise: vi.fn(),
  listExercises: vi.fn(),
}));
vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
  listSessionSets: vi.fn(),
}));

const ACCOUNT = 'exercise-create-acct';

function newClient() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerOfflineMutationDefaults(client, { retry: false });
  return client;
}

function dispatch(client, mutationKey, variables) {
  const observer = new MutationObserver(client, { ...client.getMutationDefaults(mutationKey), mutationKey });
  observer.mutate(variables).catch(() => {});
}

describe('offline: create an exercise and log against it', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearExerciseIdMap();
    await clearOutbox(ACCOUNT);
    addExercise.mockResolvedValue({ id: 4242, name: 'Zercher Squat', isGlobal: false });
    favoriteExercise.mockResolvedValue({});
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 9 }, set: { id: 1 } });
    onlineManager.setOnline(true);
    setAuthToken('test-token');
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    setAuthToken(null);
  });

  it('replays the create first, then logs the set against the real (resolved) exercise id', async () => {
    const client = newClient();
    const tempId = newTempExerciseId();

    onlineManager.setOnline(false);
    // Order matters: create is enqueued before the set, so the shared serial scope replays it first.
    dispatch(client, CREATE_EXERCISE_MUTATION_KEY, { tempId, name: 'Zercher Squat', personId: 7, idempotencyKey: 'ex-key' });
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live',
      personId: 7,
      exerciseId: tempId, // logged against the not-yet-synced exercise
      weight: 185,
      reps: 5,
      idempotencyKey: 'set-key',
      clientLoggedAt: 't',
    });

    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(2),
    );

    // Reconnect: both replay, in order.
    onlineManager.setOnline(true);
    await client.resumePausedMutations();

    // The exercise was created (with its idempotency key) and auto-favorited...
    expect(addExercise).toHaveBeenCalledWith({ name: 'Zercher Squat', idempotencyKey: 'ex-key' });
    expect(favoriteExercise).toHaveBeenCalledWith(7, 4242);
    // ...and the set was logged against the REAL id (4242), not the temp id.
    expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ exerciseId: 4242, idempotencyKey: 'set-key' }));
  });

  // Regression test for the reported production incident: under lie-fi (navigator.onLine stays
  // true), an actively-retrying write is NOT "paused" -- it only ever becomes paused if the
  // device goes genuinely offline. A reload in between used to hydrate paused writes as one
  // batch and dispatch not-paused writes as a second, separate batch (see the old
  // restoreOutbox), which could register a later-submitted-but-paused write ahead of an
  // earlier-submitted-but-still-retrying one in the shared outbox scope -- and since a mutation
  // that never settles never releases its scope slot, that permanently deadlocked EVERY queued
  // write behind it, not just the misordered ones.
  it('survives a reload mid-lie-fi: an earlier create still retrying (not paused) must not lose its scope slot to a later, paused, dependent set', async () => {
    const client1 = newClient();
    const tempId = newTempExerciseId();

    // The create is submitted first. Under lie-fi it hangs mid-request rather than pausing --
    // navigator.onLine is true, so TanStack never marks it paused, exactly like a request
    // that's actively failing/retrying against an unreachable-but-"online" backend.
    addExercise.mockReturnValue(new Promise(() => {}));
    dispatch(client1, CREATE_EXERCISE_MUTATION_KEY, { tempId, name: 'Zercher Squat', personId: 7, idempotencyKey: 'ex-key' });
    await vi.waitFor(() => {
      const [mutation] = client1.getMutationCache().getAll();
      expect(mutation.state.status).toBe('pending');
      expect(mutation.state.isPaused).toBe(false);
    });

    // The dependent log-set is submitted second, but the device goes properly offline before it
    // dispatches, so it genuinely pauses.
    onlineManager.setOnline(false);
    dispatch(client1, LOG_SET_MUTATION_KEY, {
      mode: 'live',
      personId: 7,
      exerciseId: tempId,
      weight: 185,
      reps: 5,
      idempotencyKey: 'set-key',
      clientLoggedAt: 't',
    });
    await vi.waitFor(() => {
      const logSetMutation = client1.getMutationCache().getAll().find((m) => m.options.mutationKey[0] === 'logSet');
      expect(logSetMutation.state.isPaused).toBe(true);
    });

    await persistOutboxNow(client1, ACCOUNT);

    // Simulate the reload: a fresh client restores the outbox, then real connectivity returns
    // and both writes can actually succeed.
    const client2 = newClient();
    onlineManager.setOnline(true);
    addExercise.mockResolvedValue({ id: 4242, name: 'Zercher Squat', isGlobal: false });
    await restoreOutbox(client2, ACCOUNT);
    await client2.resumePausedMutations();

    // The create must still resolve and unblock the set -- neither write may be stuck forever.
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    expect(favoriteExercise).toHaveBeenCalledWith(7, 4242);
    expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ exerciseId: 4242, idempotencyKey: 'set-key' }));
  });
});
