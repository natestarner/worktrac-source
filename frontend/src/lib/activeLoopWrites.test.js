// The rest of the active-workout loop, made durable in PR 5: edit set, delete set, notes, end
// workout, favorite. Each must queue while offline and replay against the right endpoint on reconnect.
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE_SET_MUTATION_KEY,
  EDIT_SET_MUTATION_KEY,
  END_WORKOUT_MUTATION_KEY,
  FAVORITE_MUTATION_KEY,
  SAVE_NOTE_MUTATION_KEY,
  registerOfflineMutationDefaults,
} from './queryClient';
import { editSet, deleteSet } from '../api/sets';
import { saveLiveExerciseNote, saveSessionExerciseNote } from '../api/notes';
import { endWorkout } from '../api/sessions';
import { favoriteExercise, unfavoriteExercise } from '../api/exercises';

vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(), logSetIntoSession: vi.fn(), editSet: vi.fn(), deleteSet: vi.fn(), listSessionSets: vi.fn(),
}));
vi.mock('../api/notes', () => ({
  saveLiveExerciseNote: vi.fn(), saveSessionExerciseNote: vi.fn(), getSessionExerciseNote: vi.fn(), setPersistentNote: vi.fn(),
}));
vi.mock('../api/sessions', () => ({ endWorkout: vi.fn(), getLiveSession: vi.fn(), createPastSession: vi.fn(), editSession: vi.fn(), getHistory: vi.fn() }));
vi.mock('../api/exercises', () => ({
  addExercise: vi.fn(), favoriteExercise: vi.fn(), unfavoriteExercise: vi.fn(), updateExercise: vi.fn(), listExercises: vi.fn(),
}));

function newClient() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerOfflineMutationDefaults(client, { retry: false });
  return client;
}

function dispatch(client, mutationKey, variables) {
  const observer = new MutationObserver(client, { ...client.getMutationDefaults(mutationKey), mutationKey });
  return observer.mutate(variables).catch(() => {});
}

describe('active-loop writes are durable (queue offline, replay on reconnect)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editSet.mockResolvedValue({});
    deleteSet.mockResolvedValue(null);
    saveLiveExerciseNote.mockResolvedValue({ sessionId: 9, exerciseId: 1, note: 'x' });
    saveSessionExerciseNote.mockResolvedValue({ sessionId: 9, exerciseId: 1, note: 'x' });
    endWorkout.mockResolvedValue(undefined);
    favoriteExercise.mockResolvedValue({});
    unfavoriteExercise.mockResolvedValue({});
    onlineManager.setOnline(true);
  });
  afterEach(() => onlineManager.setOnline(true));

  it('queues every active-loop write offline and replays each against its endpoint', async () => {
    const client = newClient();
    onlineManager.setOnline(false);

    dispatch(client, EDIT_SET_MUTATION_KEY, { setId: 5, weight: 100, reps: 5, personId: 7, sessionId: 9, exerciseId: 1 });
    dispatch(client, DELETE_SET_MUTATION_KEY, { setId: 6, personId: 7, sessionId: 9, exerciseId: 1 });
    dispatch(client, SAVE_NOTE_MUTATION_KEY, { mode: 'live', personId: 7, sessionId: null, exerciseId: 1, note: 'felt easy' });
    dispatch(client, END_WORKOUT_MUTATION_KEY, { personId: 7 });
    dispatch(client, FAVORITE_MUTATION_KEY, { personId: 7, exerciseId: 1, favorite: true });

    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(5),
    );
    // Nothing hit the network while paused.
    expect(editSet).not.toHaveBeenCalled();

    onlineManager.setOnline(true);
    await client.resumePausedMutations();

    expect(editSet).toHaveBeenCalledWith(5, { weight: 100, reps: 5 });
    expect(deleteSet).toHaveBeenCalledWith(6);
    expect(saveLiveExerciseNote).toHaveBeenCalledWith(7, { exerciseId: 1, note: 'felt easy' });
    expect(endWorkout).toHaveBeenCalledWith(7);
    expect(favoriteExercise).toHaveBeenCalledWith(7, 1);
  });

  it('treats a replay 404 on delete as success (already gone), not a stuck error', async () => {
    deleteSet.mockRejectedValue({ status: 404 });
    const client = newClient();

    const observer = new MutationObserver(client, {
      ...client.getMutationDefaults(DELETE_SET_MUTATION_KEY),
      mutationKey: DELETE_SET_MUTATION_KEY,
    });
    await observer.mutate({ setId: 6, personId: 7, sessionId: 9, exerciseId: 1 });

    expect(observer.getCurrentResult().status).toBe('success');
  });

  it('a session note replays against the session endpoint', async () => {
    const client = newClient();
    await new MutationObserver(client, {
      ...client.getMutationDefaults(SAVE_NOTE_MUTATION_KEY),
      mutationKey: SAVE_NOTE_MUTATION_KEY,
    }).mutate({ mode: 'session', personId: 7, sessionId: 42, exerciseId: 1, note: 'hi' });

    expect(saveSessionExerciseNote).toHaveBeenCalledWith(42, 1, 'hi');
    expect(saveLiveExerciseNote).not.toHaveBeenCalled();
  });
});
