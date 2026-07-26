import { MutationObserver, QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionEntries } from './useSessionEntries';
import { CREATE_EXERCISE_MUTATION_KEY, LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from '../lib/queryClient';
import { logLiveSet } from '../api/sets';
import { addExercise } from '../api/exercises';

vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
}));
vi.mock('../api/exercises', () => ({
  addExercise: vi.fn(),
  favoriteExercise: vi.fn(),
  unfavoriteExercise: vi.fn(),
}));
vi.mock('../api/notes', () => ({ saveLiveExerciseNote: vi.fn(), saveSessionExerciseNote: vi.fn() }));
vi.mock('../api/sessions', () => ({ endWorkout: vi.fn() }));

const exercises = [{ id: 1, name: 'Bench Press' }, { id: 2, name: 'Squat' }];

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

function renderWithClient(client, props) {
  return renderHook((p) => useSessionEntries(p), {
    initialProps: props,
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe('useSessionEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    addExercise.mockResolvedValue({ id: 999 });
    onlineManager.setOnline(true);
  });

  afterEach(() => onlineManager.setOnline(true));

  it('returns serverEntries unchanged when nothing is pending', () => {
    const serverEntries = [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ id: 55, weight: 135, reps: 5, unit: 'lb' }] }];
    const { result } = renderWithClient(newClient(), { personId: 7, serverEntries, exercises });
    expect(result.current).toEqual(serverEntries);
  });

  it('adds a new entry (with a resolved name) for an offline-logged set against an exercise not yet in server history', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 2, weight: 225, reps: 3, unit: 'lb', idempotencyKey: 'a', clientLoggedAt: 't', tempId: 'temp-a',
    });

    const { result } = renderWithClient(client, { personId: 7, serverEntries: [], exercises });
    await vi.waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({
      exerciseId: 2,
      exerciseName: 'Squat',
      sets: [{ id: 'temp-a', weight: 225, reps: 3, unit: 'lb', optimistic: true }],
    });
  });

  it('merges an offline-logged set into an entry the server already has for that exercise, without duplicating', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 140, reps: 4, unit: 'lb', idempotencyKey: 'b', clientLoggedAt: 't', tempId: 'temp-b',
    });
    const serverEntries = [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ id: 55, weight: 135, reps: 5, unit: 'lb' }] }];

    const { result } = renderWithClient(client, { personId: 7, serverEntries, exercises });
    await vi.waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].sets).toHaveLength(2);
    expect(result.current[0].sets[0]).toMatchObject({ id: 55 });
    expect(result.current[0].sets[1]).toMatchObject({ id: 'temp-b', optimistic: true });
    // The original server entries array/object must never be mutated in place.
    expect(serverEntries[0].sets).toHaveLength(1);
  });

  it('resolves an offline-created exercise by name via its sibling pending createExercise mutation', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    const tempId = 'temp-exercise-xyz';
    dispatch(client, CREATE_EXERCISE_MUTATION_KEY, { personId: 7, name: 'Zercher Squat', tempId, idempotencyKey: 'c' });
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: tempId, weight: 45, reps: 10, unit: 'lb', idempotencyKey: 'd', clientLoggedAt: 't', tempId: 'temp-d',
    });

    const { result } = renderWithClient(client, { personId: 7, serverEntries: [], exercises });
    await vi.waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].exerciseName).toBe('Zercher Squat');
  });

  it('ignores another person\'s pending sets', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 8, exerciseId: 1, weight: 100, reps: 5, unit: 'lb', idempotencyKey: 'e', clientLoggedAt: 't', tempId: 'temp-e',
    });

    const { result } = renderWithClient(client, { personId: 7, serverEntries: [], exercises });
    // Give any (incorrect) update a chance to land, then assert it never did.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toEqual([]);
  });

  // Regression test for a bug where the personId filter lived INSIDE the useSyncExternalStore
  // snapshot, which is only recomputed on a mutation-cache event -- so switching people (a prop
  // change with no such event) kept showing the previous person's pending sets until some
  // unrelated mutation happened to fire and force a recompute.
  it('immediately reflects a person switch, with no bleed from the previous person, even with no new mutation event', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb', idempotencyKey: 'g', clientLoggedAt: 't', tempId: 'temp-g',
    });

    const { result, rerender } = renderWithClient(client, { personId: 7, serverEntries: [], exercises });
    await vi.waitFor(() => expect(result.current).toHaveLength(1));

    // Switching to a person with nothing pending -- no mutation dispatched here, so this is purely
    // a props/render change, exactly the case the buggy memoized-by-personId snapshot got wrong.
    rerender({ personId: 8, serverEntries: [], exercises });
    expect(result.current).toEqual([]);

    // And switching back must show person 7's set again, still with no new mutation event.
    rerender({ personId: 7, serverEntries: [], exercises });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].sets[0]).toMatchObject({ id: 'temp-g' });
  });

  it('drops back to server-only once the pending set syncs', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb', idempotencyKey: 'f', clientLoggedAt: 't', tempId: 'temp-f',
    });

    const { result } = renderWithClient(client, { personId: 7, serverEntries: [], exercises });
    await vi.waitFor(() => expect(result.current).toHaveLength(1));

    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    await vi.waitFor(() => expect(result.current).toEqual([]));
  });
});
