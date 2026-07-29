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
}));
vi.mock('../api/stats', () => ({
  getPrs: vi.fn().mockResolvedValue([]),
}));

import { listExercises, listPersonExercises } from '../api/exercises';
import { listTags } from '../api/tags';
import { listRoutines } from '../api/routines';
import { getLiveSession, getHistory } from '../api/sessions';
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

    for (const person of PEOPLE) {
      expect(listPersonExercises).toHaveBeenCalledWith(person.id);
      expect(listRoutines).toHaveBeenCalledWith(person.id);
      expect(getLiveSession).toHaveBeenCalledWith(person.id);
      expect(getHistory).toHaveBeenCalledWith(person.id);
      expect(getPrs).toHaveBeenCalledWith(person.id);
      expect(client.getQueryData(queryKeys.history(person.id))).toEqual([]);
      expect(client.getQueryData(queryKeys.prs(person.id))).toEqual([]);
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
