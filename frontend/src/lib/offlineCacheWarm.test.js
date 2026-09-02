import { QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmOfflineCache } from './offlineCacheWarm';
import { queryKeys } from '../api/queryKeys';

vi.mock('../api/exercises', () => ({
  listExercises: vi.fn().mockResolvedValue([{ id: 1, name: 'Squat' }]),
  listPersonExercises: vi.fn().mockResolvedValue([]),
}));
vi.mock('../api/tags', () => ({
  listTags: vi.fn().mockResolvedValue([]),
}));
vi.mock('../api/routines', () => ({
  listRoutines: vi.fn().mockResolvedValue([]),
}));
vi.mock('../api/sessions', () => ({
  getLiveSession: vi.fn().mockResolvedValue(null),
  getHistory: vi.fn().mockResolvedValue([]),
  getHistoryWindow: vi.fn().mockResolvedValue({ windowStart: null, hiddenSessions: 0, earliestHiddenAt: null }),
}));
vi.mock('../api/stats', () => ({
  getPrs: vi.fn().mockResolvedValue([]),
}));

import { listExercises, listPersonExercises } from '../api/exercises';
import { listTags } from '../api/tags';
import { listRoutines } from '../api/routines';
import { getLiveSession, getHistory, getHistoryWindow } from '../api/sessions';
import { getPrs } from '../api/stats';

const PEOPLE = [{ id: 1 }, { id: 2 }];

describe('warmOfflineCache', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    client = new QueryClient();
  });

  afterEach(() => {
    client.clear();
    onlineManager.setOnline(true);
  });

  it('warms the shared catalog/tags once and each person\'s logging-essentials keys', async () => {
    await warmOfflineCache(client, PEOPLE);

    expect(listExercises).toHaveBeenCalledTimes(1);
    expect(listTags).toHaveBeenCalledTimes(1);
    expect(listPersonExercises).toHaveBeenCalledTimes(2);
    expect(listRoutines).toHaveBeenCalledTimes(2);
    expect(getLiveSession).toHaveBeenCalledTimes(2);
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(getPrs).toHaveBeenCalledTimes(2);
    expect(getHistoryWindow).toHaveBeenCalledTimes(2);

    for (const person of PEOPLE) {
      expect(listPersonExercises).toHaveBeenCalledWith(person.id);
      expect(listRoutines).toHaveBeenCalledWith(person.id);
      expect(getLiveSession).toHaveBeenCalledWith(person.id);
      expect(getHistory).toHaveBeenCalledWith(person.id);
      expect(getPrs).toHaveBeenCalledWith(person.id);
      expect(client.getQueryData(queryKeys.history(person.id))).toEqual([]);
      expect(client.getQueryData(queryKeys.prs(person.id))).toEqual([]);
      // Without this key warmed, the three clamped tabs go back to looking COMPLETE while offline
      // -- the same screen saying two different things depending on the network, which is the one
      // thing resilience.md forbids outright. It is one small row per person, unlike the trends
      // fan-out deliberately excluded below.
      expect(getHistoryWindow).toHaveBeenCalledWith(person.id);
      expect(client.getQueryData(queryKeys.historyWindow(person.id))).toEqual({
        windowStart: null,
        hiddenSessions: 0,
        earliestHiddenAt: null,
      });
    }
    expect(client.getQueryData(queryKeys.exercises())).toEqual([{ id: 1, name: 'Squat' }]);
  });

  it('does NOT warm the analytics fan-out (trends) or session-scoped exercise-detail keys', async () => {
    await warmOfflineCache(client, PEOPLE);

    expect(client.getQueryData(queryKeys.trendsOverview(1, 12))).toBeUndefined();
    expect(client.getQueryData(queryKeys.exerciseTrend(1, 5, 12))).toBeUndefined();
    // exerciseSummary is deliberately still not prefetched here -- ExerciseDetail derives it
    // client-side from the (now-warmed) history cache instead. See exerciseSummaryFromHistory.js.
    expect(client.getQueryData(queryKeys.exerciseSummary(1, 5, null))).toBeUndefined();
    expect(client.getQueryData(queryKeys.sessionSets(null, 5))).toBeUndefined();
  });

  it('is a no-op while offline', async () => {
    onlineManager.setOnline(false);

    await warmOfflineCache(client, PEOPLE);

    expect(listExercises).not.toHaveBeenCalled();
    expect(getHistory).not.toHaveBeenCalled();
    expect(getPrs).not.toHaveBeenCalled();
  });

  it('is a no-op with an empty or missing people list', async () => {
    await warmOfflineCache(client, []);
    await warmOfflineCache(client, null);

    expect(getLiveSession).not.toHaveBeenCalled();
    // Shared catalog/tags targets are only built once people.flatMap runs, but the whole call
    // short-circuits before building targets at all when there's no one to warm for.
    expect(listExercises).not.toHaveBeenCalled();
  });

  it('does not let one failed warm abort the rest (Promise.allSettled fan-out)', async () => {
    getHistory.mockRejectedValueOnce(new Error('network blip'));

    await expect(warmOfflineCache(client, PEOPLE)).resolves.toBeUndefined();

    expect(listExercises).toHaveBeenCalledTimes(1);
    expect(getLiveSession).toHaveBeenCalledTimes(2);
  });
});

// Issue #146. A restored entry's dataUpdatedAt describes the previous page session, so "fresh"
// is not the same as "correct" -- anything the throttled (1s) persister missed is silently
// preserved as stale. The boot warm is the one chance to repair that before the 5-minute tick.
describe('warmOfflineCache afterRestore', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    client = new QueryClient();
  });
  afterEach(() => {
    client.clear();
    onlineManager.setOnline(true);
  });

  // A just-created offline exercise carrying every personalization that rides on this same key --
  // favorite, tags and the persistent note all live on PersonExerciseDto, and the favorite flag in
  // particular is written optimistically (ExerciseDetail#handleToggleFavorite) so the star responds
  // instantly offline. All of it is local-only until the outbox drains.
  const UNSYNCED_EXERCISE = {
    id: 99,
    name: 'Temp Squat',
    isFavorite: true,
    tags: [{ id: 1, name: 'Legs' }],
    note: 'belt on the top set',
  };

  // Seeds every warmed key as if it had just been restored from disk: present, and new enough
  // that the ordinary 30s warm staleness check would skip it.
  function seedRestoredCache() {
    for (const person of PEOPLE) {
      client.setQueryData(queryKeys.routines(person.id), []);
      client.setQueryData(queryKeys.history(person.id), []);
      client.setQueryData(queryKeys.prs(person.id), []);
      client.setQueryData(queryKeys.personExercises(person.id), [UNSYNCED_EXERCISE]);
      client.setQueryData(queryKeys.liveSession(person.id), null);
      client.setQueryData(queryKeys.historyWindow(person.id), {
        windowStart: null,
        hiddenSessions: 0,
        earliestHiddenAt: null,
      });
    }
    client.setQueryData(queryKeys.exercises(), [UNSYNCED_EXERCISE]);
  }

  it('an ordinary warm skips a just-restored cache entirely -- this is the bug', async () => {
    seedRestoredCache();

    await warmOfflineCache(client, PEOPLE);

    // Everything looks fresh, so nothing is refetched and a routine created just before the
    // reload stays invisible.
    expect(listRoutines).not.toHaveBeenCalled();
    expect(getHistory).not.toHaveBeenCalled();
    expect(getPrs).not.toHaveBeenCalled();
    expect(getHistoryWindow).not.toHaveBeenCalled();
  });

  it('the boot warm refetches the server-owned collections even though they look fresh', async () => {
    seedRestoredCache();
    listRoutines.mockResolvedValue([{ id: 7, name: 'Push Day' }]);

    await warmOfflineCache(client, PEOPLE, { afterRestore: true });

    expect(listRoutines).toHaveBeenCalledTimes(2);
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(getPrs).toHaveBeenCalledTimes(2);
    // Forced for the same reason as history and prs, one step stronger: it is a pure server-side
    // derivation of the billing state and the clock, so the client could not be holding an unsent
    // version of it even in principle. It also goes stale on its own as the window slides.
    expect(getHistoryWindow).toHaveBeenCalledTimes(2);
    // The routine the persister never got to write is now back.
    expect(client.getQueryData(queryKeys.routines(1))).toEqual([{ id: 7, name: 'Push Day' }]);
  });

  // The seesaw this fix must not cause. Two independent optimistic writers park unsynced state in
  // these keys: insertOptimisticExercise (AddEditExerciseModal) for a queued custom exercise, and
  // handleToggleFavorite (ExerciseDetail) for a star tapped offline -- which also carries that
  // exercise's tags and persistent note, since all three live on PersonExerciseDto. liveSession is
  // excluded for the same reason (EndWorkoutConfirmModal nulls it optimistically on end-workout).
  // Refetching any of them at boot would silently discard work the outbox still owes the server.
  it('does NOT refetch the keys that can hold unsynced local state', async () => {
    seedRestoredCache();

    await warmOfflineCache(client, PEOPLE, { afterRestore: true });

    expect(listExercises).not.toHaveBeenCalled();
    expect(listPersonExercises).not.toHaveBeenCalled();
    expect(getLiveSession).not.toHaveBeenCalled();

    // The queued exercise is still selectable, still starred, and still carries its tags and note.
    expect(client.getQueryData(queryKeys.exercises())).toEqual([UNSYNCED_EXERCISE]);
    expect(client.getQueryData(queryKeys.personExercises(1))).toEqual([UNSYNCED_EXERCISE]);
    expect(client.getQueryData(queryKeys.personExercises(1))[0].isFavorite).toBe(true);
    expect(client.getQueryData(queryKeys.personExercises(1))[0].note).toBe('belt on the top set');
  });

  it('is still a no-op while offline, so a boot warm cannot clobber an offline cache', async () => {
    seedRestoredCache();
    onlineManager.setOnline(false);

    await warmOfflineCache(client, PEOPLE, { afterRestore: true });

    expect(listRoutines).not.toHaveBeenCalled();
    expect(getHistory).not.toHaveBeenCalled();
  });

  it('keeps the restored data when a forced refetch fails (lie-fi boot)', async () => {
    seedRestoredCache();
    client.setQueryData(queryKeys.history(1), ['workout-A']);
    getHistory.mockRejectedValue(new Error('Failed to fetch'));

    await expect(warmOfflineCache(client, PEOPLE, { afterRestore: true })).resolves.toBeUndefined();

    // A failed background refetch leaves `data` untouched -- the same guarantee the persisted
    // cache relies on in queryClient.test.js's round-trip test.
    expect(client.getQueryData(queryKeys.history(1))).toEqual(['workout-A']);
  });
});
