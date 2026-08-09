// A real (in-memory) IndexedDB so the reload-simulation test below can exercise the actual
// persist/restore path, not a no-op. Imported first so `indexedDB` is defined before the modules
// under test read `typeof indexedDB`.
import 'fake-indexeddb/auto';
import { MutationObserver, QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOutboxItems } from './useOutboxItems';
import { CREATE_EXERCISE_MUTATION_KEY, LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from '../lib/queryClient';
import { persistOutboxNow, restoreOutbox } from '../lib/outboxPersistence';
import { useAuth } from '../context/AuthContext';
import { useExercises } from './useExercises';
import { logLiveSet } from '../api/sets';
import { addExercise } from '../api/exercises';
import { setAuthToken } from '../api/client';

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

  // Regression test for the reported bug: the list used to sort by TanStack's own `submittedAt`,
  // which gets RE-STAMPED to "now" every time a write is re-executed -- including restoreOutbox's
  // re-dispatch of an actively-retrying (not-paused, e.g. lie-fi) write after a reload. That made an
  // earlier-enqueued write visibly sink BELOW a later one in this exact list, even though the
  // underlying replay order was still correct. Sorting by enqueueSeq instead (immutable, never
  // re-stamped by a reload) keeps the displayed order matching true enqueue order.
  describe('display order survives a reload (enqueueSeq, not submittedAt)', () => {
    const ACCOUNT = 'outbox-items-reload-acct';

    beforeEach(() => setAuthToken('test-token'));
    afterEach(() => setAuthToken(null));

    it('keeps an earlier-enqueued write listed ahead of a later one, even though the earlier one\'s submittedAt gets re-stamped by the reload', async () => {
      // Enqueued first (enqueueSeq: 1), but stays mid-retry (not paused) rather than settling --
      // lie-fi (navigator.onLine stays true, only the backend is unreachable).
      logLiveSet.mockReturnValueOnce(new Promise(() => {}));
      const client1 = newClient();
      dispatch(client1, LOG_SET_MUTATION_KEY, {
        mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb', idempotencyKey: 'earlier', clientLoggedAt: 't', tempId: 'temp-earlier', enqueueSeq: 1,
      });
      await vi.waitFor(() => {
        const [mutation] = client1.getMutationCache().getAll();
        expect(mutation.state.status).toBe('pending');
        expect(mutation.state.isPaused).toBe(false);
      });

      // Enqueued second (enqueueSeq: 2), but genuinely offline -- paused.
      onlineManager.setOnline(false);
      dispatch(client1, LOG_SET_MUTATION_KEY, {
        mode: 'live', personId: 7, exerciseId: 1, weight: 999, reps: 9, unit: 'lb', idempotencyKey: 'later', clientLoggedAt: 't', tempId: 'temp-later', enqueueSeq: 2,
      });
      await vi.waitFor(() => {
        const paused = client1.getMutationCache().getAll().filter((m) => m.state.isPaused);
        expect(paused).toHaveLength(1);
      });
      await persistOutboxNow(client1, ACCOUNT);

      // Reload: a fresh client restores. The device stays hard-offline through the restore itself
      // (deliberately, for THIS test) so neither write actually attempts a request or settles --
      // isolating the display-order assertion from network timing/auto-continuation entirely. The
      // "earlier" write was not-paused at persist time, so restoreOutbox re-dispatches it fresh here
      // -- freshly re-stamping its submittedAt to now, well past "later"'s untouched, original,
      // smaller submittedAt (restored via hydrate, unchanged). Its enqueueSeq (1) must still win.
      const client2 = newClient();
      await restoreOutbox(client2, ACCOUNT);
      await vi.waitFor(() => {
        expect(client2.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(2);
      });

      const { result } = renderWithClient(client2);
      await vi.waitFor(() => expect(result.current).toHaveLength(2));
      expect(result.current.map((item) => item.detail)).toEqual(['logged 135 lb × 5', 'logged 999 lb × 9']);
    });
  });
});

// Same mechanism as useSessionEntries.test.jsx's scheduling case -- see the long comment there.
// This hook backs the offline banner's expanded list, which sits above the whole Log tab, so a
// child rendering beneath it must not be able to schedule an update on it mid-render.
describe('useOutboxItems mutation-cache notification scheduling', () => {
  it('never schedules a parent update from inside a child render', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    const seen = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      seen.push(args.map((a) => (typeof a === 'string' ? a : '')).join(' '));
    });

    try {
      let dispatched = false;
      function Child() {
        if (!dispatched) {
          dispatched = true;
          dispatch(client, LOG_SET_MUTATION_KEY, {
            mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb',
            idempotencyKey: 'notify-items', clientLoggedAt: 't', tempId: 'temp-notify-items',
          });
        }
        return null;
      }
      // Child mounts only on the second render, once the parent's subscription is live -- on a
      // first render nothing is subscribed yet and the bug cannot show.
      function Parent({ showChild }) {
        useOutboxItems();
        return showChild ? <Child /> : null;
      }

      const { rerender } = render(
        <QueryClientProvider client={client}>
          <Parent showChild={false} />
        </QueryClientProvider>,
      );
      rerender(
        <QueryClientProvider client={client}>
          <Parent showChild />
        </QueryClientProvider>,
      );

      await vi.waitFor(() => expect(dispatched).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(seen.filter((line) => /while rendering a different component/.test(line))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
