// The headline PR 4 guarantee: create an exercise AND log a set against it while fully offline, then
// on reconnect the create replays FIRST and the set replays against the REAL server id -- never lost,
// never orphaned against a temp id.
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREATE_EXERCISE_MUTATION_KEY,
  LOG_SET_MUTATION_KEY,
  registerOfflineMutationDefaults,
} from './queryClient';
import { clearExerciseIdMap, newTempExerciseId } from './exerciseIdMap';
import { addExercise, favoriteExercise } from '../api/exercises';
import { logLiveSet } from '../api/sets';

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
    addExercise.mockResolvedValue({ id: 4242, name: 'Zercher Squat', isGlobal: false });
    favoriteExercise.mockResolvedValue({});
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 9 }, set: { id: 1 } });
    onlineManager.setOnline(true);
  });
  afterEach(() => onlineManager.setOnline(true));

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
});
