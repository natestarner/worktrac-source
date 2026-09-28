import { MutationObserver, QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrs } from './usePrs';
import { useExerciseRecords } from './useExerciseRecords';
import { LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from '../lib/queryClient';
import { markCreatesEnded } from '../lib/endedSessions';
import { queryKeys } from '../api/queryKeys';
import { getHistory, getHistoryWindow, getLiveSession } from '../api/sessions';
import { listExercises } from '../api/exercises';

vi.mock('../api/sessions', () => ({
  getHistory: vi.fn(),
  getHistoryWindow: vi.fn(),
  getLiveSession: vi.fn(),
  endWorkout: vi.fn(),
}));
vi.mock('../api/exercises', () => ({ listExercises: vi.fn(), addExercise: vi.fn(), favoriteExercise: vi.fn(), unfavoriteExercise: vi.fn() }));
vi.mock('../api/sets', () => ({ logLiveSet: vi.fn(), logSetIntoSession: vi.fn(), editSet: vi.fn(), deleteSet: vi.fn() }));
vi.mock('../api/notes', () => ({ saveLiveExerciseNote: vi.fn(), saveSessionExerciseNote: vi.fn() }));
vi.mock('../api/stats', () => ({ getPrs: vi.fn(() => Promise.reject(new Error('the board must not call /prs'))) }));

// The board and Trends come from the History this device holds (useStatsFromHistory), with the
// workout in progress folded in -- its queued sets included, so a record with no signal is on the
// board at once. These drive the real query cache and real queued writes.

const PERSON = 7;
const bench = { exerciseId: 1, exerciseName: 'Bench Press' };
const set = (weight, reps) => ({ weight, reps, durationSeconds: null, unit: 'lb' });
const history = {
  format: 2,
  months: {
    '2026-08': { fp: 'a', sessions: [{ id: 20, startedAt: '2026-08-10T17:00:00Z', entries: [{ ...bench, sets: [set(185, 5)], note: null }] }] },
    '2026-09': { fp: 'b', sessions: [{ id: 30, startedAt: '2026-09-28T17:00:00Z', entries: [{ ...bench, sets: [set(135, 5)], note: null }] }] },
  },
  checked: {},
};

function newClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  registerOfflineMutationDefaults(client, { retry: false });
  return client;
}

function seed(client, { live = null, noHistory = false } = {}) {
  if (!noHistory) client.setQueryData(queryKeys.history(PERSON), history);
  client.setQueryData(queryKeys.liveSession(PERSON), live);
  client.setQueryData(queryKeys.historyWindow(PERSON), { windowStart: null, hiddenSessions: 0, earliestHiddenAt: null });
  client.setQueryData(queryKeys.exercises(), [{ id: 1, name: 'Bench Press' }]);
}

function queueSet(client, vars) {
  const observer = new MutationObserver(client, { ...client.getMutationDefaults(LOG_SET_MUTATION_KEY), mutationKey: LOG_SET_MUTATION_KEY });
  observer.mutate({ personId: PERSON, exerciseId: 1, unit: 'lb', idempotencyKey: vars.tempId, clientLoggedAt: 't', ...vars }).catch(() => {});
}

function render(client, hook) {
  return renderHook(hook, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

describe('the PRs board from History', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    onlineManager.setOnline(true);
    getHistory.mockResolvedValue(history);
    getHistoryWindow.mockResolvedValue({ windowStart: null, hiddenSessions: 0, earliestHiddenAt: null });
    getLiveSession.mockResolvedValue(null);
    listExercises.mockResolvedValue([{ id: 1, name: 'Bench Press' }]);
  });
  afterEach(() => onlineManager.setOnline(true));

  it('is built from the History this device holds, with no request of its own', () => {
    const client = newClient();
    seed(client);
    const { result } = render(client, () => usePrs(PERSON));
    expect(result.current.status).toBe('ready');
    expect(result.current.prs).toHaveLength(1);
    expect(result.current.prs[0].best).toMatchObject({ weight: 185, reps: 5, sessionStartedAt: '2026-08-10T17:00:00Z' });
  });

  it('puts a record logged with no signal on the board at once, before any session exists', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    seed(client, { live: { id: null } });
    queueSet(client, { mode: 'live', weight: 225, reps: 3, tempId: 'temp-1' });

    const { result } = render(client, () => usePrs(PERSON));
    await vi.waitFor(() => expect(result.current.prs[0].best).toMatchObject({ weight: 225, reps: 3 }));
  });

  it('replaces the synced copy of the live workout rather than counting it twice', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    seed(client, { live: { id: 30, startedAt: '2026-09-28T17:00:00Z' } });
    queueSet(client, { mode: 'live', weight: 140, reps: 5, tempId: 'temp-2' });

    const { result } = render(client, () => useExerciseRecords(PERSON, 1));
    // Two synced sets (185, 135) plus the queued one: three, never four.
    await vi.waitFor(() => expect(result.current.records.totalSets).toBe(3));
    expect(result.current.records.totalReps).toBe(15);
  });

  it('does not fold sets queued into a PAST workout being edited', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    seed(client, { live: { id: null } });
    queueSet(client, { mode: 'session', sessionId: 20, weight: 300, reps: 1, tempId: 'temp-3' });

    const { result } = render(client, () => usePrs(PERSON));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.prs[0].best).toMatchObject({ weight: 185, reps: 5 });
  });

  it('does not fold the queued sets of a workout already ended into the next one', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    seed(client, { live: { id: null } });
    queueSet(client, { mode: 'live', weight: 300, reps: 1, tempId: 'temp-ended' });
    markCreatesEnded(PERSON, ['temp-ended']);

    const { result } = render(client, () => usePrs(PERSON));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.prs[0].best).toMatchObject({ weight: 185, reps: 5 });
  });

  // The hand-off. A set leaves the queue the moment its save succeeds, but History only learns of it
  // when the refresh that save triggers lands (a round trip -- ~340 ms on lower, longer in lie-fi).
  // In between it is in neither, and a record set would blink off the board. It must stay until a
  // History fetched AFTER the save is in hand -- and then count once, not twice.
  it('keeps a just-saved set on the board until History has caught up, and then counts it once', async () => {
    const client = newClient();
    seed(client, { live: { id: 30, startedAt: '2026-09-28T17:00:00Z' } });
    // After a live set the app refetches the live session; the server still has this workout live.
    getLiveSession.mockResolvedValue({ id: 30, startedAt: '2026-09-28T17:00:00Z' });
    const { logLiveSet } = await import('../api/sets');
    logLiveSet.mockResolvedValue({ isPR: false, set: { id: 501, weight: 140, reps: 5, unit: 'lb' }, session: { id: 30, startedAt: '2026-09-28T17:00:00Z' } });
    let catchUp;
    getHistory.mockReturnValue(new Promise((resolve) => { catchUp = resolve; }));

    const { result } = render(client, () => useExerciseRecords(PERSON, 1));
    expect(result.current.records.totalSets).toBe(2);
    queueSet(client, { mode: 'live', weight: 140, reps: 5, tempId: 'temp-handoff' });

    await vi.waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('success'));
    // Saved, History's refresh still in flight: the set is not in History yet -- still counted.
    await vi.waitFor(() => expect(result.current.records.totalSets).toBe(3));

    const caughtUp = structuredClone(history);
    caughtUp.months['2026-09'].sessions[0].entries[0].sets.push(set(140, 5));
    caughtUp.months['2026-09'].fp = 'b2';
    catchUp(caughtUp);
    await vi.waitFor(() => expect(client.getQueryData(queryKeys.history(PERSON)).months['2026-09'].fp).toBe('b2'));
    // History has it now: counted once, from History.
    expect(result.current.records.totalSets).toBe(3);
  });

  it('is unavailable -- never an empty board -- offline on a device that has never held History', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    seed(client, { noHistory: true });
    const { result } = render(client, () => usePrs(PERSON));
    await vi.waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.loading).toBe(false);
  });

  it('is ready offline whenever History is held, however old', () => {
    const client = newClient();
    onlineManager.setOnline(false);
    seed(client);
    const { result } = render(client, () => usePrs(PERSON));
    expect(result.current.status).toBe('ready');
    expect(result.current.prs).toHaveLength(1);
  });

  it('is loading while History is on its way', async () => {
    const client = newClient();
    getHistory.mockReturnValue(new Promise(() => {}));
    seed(client, { noHistory: true });
    const { result } = render(client, () => usePrs(PERSON));
    await vi.waitFor(() => expect(result.current.status).toBe('loading'));
    expect(result.current.loading).toBe(true);
  });
});
