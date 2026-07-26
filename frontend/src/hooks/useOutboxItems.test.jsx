import { MutationObserver, QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOutboxItems } from './useOutboxItems';
import { CREATE_EXERCISE_MUTATION_KEY, LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from '../lib/queryClient';
import { useAuth } from '../context/AuthContext';
import { useExercises } from './useExercises';
import { logLiveSet } from '../api/sets';
import { addExercise } from '../api/exercises';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./useExercises', () => ({ useExercises: vi.fn() }));
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

function renderWithClient(client) {
  return renderHook(() => useOutboxItems(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe('useOutboxItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    useExercises.mockReturnValue({ exercises: [{ id: 1, name: 'Bench Press' }] });
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    addExercise.mockResolvedValue({ id: 999 });
    onlineManager.setOnline(true);
  });

  afterEach(() => onlineManager.setOnline(true));

  it('returns an empty list with nothing queued', () => {
    const { result } = renderWithClient(newClient());
    expect(result.current).toEqual([]);
  });

  it('describes queued log-sets in enqueue order, resolved against the real catalog', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb', idempotencyKey: 'a', clientLoggedAt: 't', tempId: 'temp-a',
    });
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 140, reps: 3, unit: 'lb', idempotencyKey: 'b', clientLoggedAt: 't', tempId: 'temp-b',
    });

    const { result } = renderWithClient(client);
    await vi.waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0]).toMatchObject({ personName: 'Nate', exerciseName: 'Bench Press', detail: 'logged 135 lb × 5' });
    expect(result.current[1]).toMatchObject({ detail: 'logged 140 lb × 3' });
  });

  it('resolves an offline-created exercise by name via its sibling queued createExercise mutation', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    const tempId = 'temp-exercise-xyz';
    dispatch(client, CREATE_EXERCISE_MUTATION_KEY, { personId: 7, name: 'Zercher Squat', tempId, idempotencyKey: 'c' });
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: tempId, weight: 45, reps: 10, unit: 'lb', idempotencyKey: 'd', clientLoggedAt: 't', tempId: 'temp-d',
    });

    const { result } = renderWithClient(client);
    await vi.waitFor(() => expect(result.current).toHaveLength(2));
    const logItem = result.current.find((item) => item.detail.startsWith('logged'));
    expect(logItem.exerciseName).toBe('Zercher Squat');
  });

  it('drops back to empty once queued writes drain on reconnect', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb', idempotencyKey: 'e', clientLoggedAt: 't', tempId: 'temp-e',
    });

    const { result } = renderWithClient(client);
    await vi.waitFor(() => expect(result.current).toHaveLength(1));

    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    await vi.waitFor(() => expect(result.current).toHaveLength(0));
  });

  it('still lists a write once it has terminal-errored, not just while paused', async () => {
    const client = newClient();
    logLiveSet.mockRejectedValueOnce({ status: 500 });
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb', idempotencyKey: 'errored', clientLoggedAt: 't', tempId: 'temp-f',
    });

    const { result } = renderWithClient(client);
    await vi.waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].detail).toBe('logged 135 lb × 5');
  });

  it('does not list a brand-new online write during its normal fast first attempt', async () => {
    const client = newClient();
    logLiveSet.mockReturnValue(new Promise(() => {})); // never resolves -- first attempt still in flight
    dispatch(client, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb', idempotencyKey: 'in-flight', clientLoggedAt: 't', tempId: 'temp-g',
    });

    const { result } = renderWithClient(client);
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
