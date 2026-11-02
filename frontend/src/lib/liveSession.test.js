import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveSession } from './liveSession';
import { markCreatesEnded } from './endedSessions';
import { LOG_SET_MUTATION_KEY } from './queryClient';
import { queryKeys } from '../api/queryKeys';
import { getLiveSession } from '../api/sessions';

vi.mock('../api/sessions', () => ({ getLiveSession: vi.fn() }));

const PERSON = 7;
const PLACEHOLDER = { id: null, startedAt: '2026-11-02T13:14:00Z' };
const REAL = { id: 55, startedAt: '2026-11-02T13:14:00Z' };

describe('fetchLiveSession', () => {
  let client;

  // A live-set create that never lands -- queued offline, or still on the wire.
  function queueSet(tempId, overrides = {}, mutationFn = () => new Promise(() => {})) {
    return new MutationObserver(client, { mutationKey: LOG_SET_MUTATION_KEY, mutationFn, retry: false })
      .mutate({ mode: 'live', personId: PERSON, exerciseId: 1, tempId, clientLoggedAt: PLACEHOLDER.startedAt, ...overrides })
      .catch(() => {});
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    client = new QueryClient();
  });
  afterEach(() => {
    client.clear();
    localStorage.clear();
  });

  // The bug: the server's honest "none" -- it has not seen the queued set yet -- replaced the
  // workout that set had started.
  it('keeps the placeholder when the server says none but this person has a set queued', async () => {
    client.setQueryData(queryKeys.liveSession(PERSON), PLACEHOLDER);
    queueSet('optimistic-a');
    getLiveSession.mockResolvedValue(null);

    expect(await fetchLiveSession(client, PERSON)).toBe(PLACEHOLDER);
  });

  it('always takes a real session over the placeholder -- that is how it gets its id', async () => {
    client.setQueryData(queryKeys.liveSession(PERSON), PLACEHOLDER);
    queueSet('optimistic-a');
    getLiveSession.mockResolvedValue(REAL);

    expect(await fetchLiveSession(client, PERSON)).toEqual(REAL);
  });

  it('clears the placeholder when nothing is queued for it', async () => {
    client.setQueryData(queryKeys.liveSession(PERSON), PLACEHOLDER);
    getLiveSession.mockResolvedValue(null);

    expect(await fetchLiveSession(client, PERSON)).toBeNull();
  });

  // End workout writes null with the workout's sets still queued; that null must stand.
  it('never turns a null into a placeholder', async () => {
    client.setQueryData(queryKeys.liveSession(PERSON), null);
    queueSet('optimistic-a');
    getLiveSession.mockResolvedValue(null);

    expect(await fetchLiveSession(client, PERSON)).toBeNull();
  });

  it('answers null when nothing is cached yet', async () => {
    queueSet('optimistic-a');
    getLiveSession.mockResolvedValue(null);

    expect(await fetchLiveSession(client, PERSON)).toBeNull();
  });

  // A reload inside the 1s persist window can restore the placeholder of a workout already ended;
  // its queued sets belong to that finished workout and must not hold it open.
  it('does not let the sets of an ended workout hold a placeholder open', async () => {
    client.setQueryData(queryKeys.liveSession(PERSON), PLACEHOLDER);
    queueSet('optimistic-a');
    markCreatesEnded(PERSON, ['optimistic-a']);
    getLiveSession.mockResolvedValue(null);

    expect(await fetchLiveSession(client, PERSON)).toBeNull();
  });

  it('keeps it while ANY queued set is outside an ended workout', async () => {
    client.setQueryData(queryKeys.liveSession(PERSON), PLACEHOLDER);
    queueSet('optimistic-ended');
    markCreatesEnded(PERSON, ['optimistic-ended']);
    queueSet('optimistic-new');
    getLiveSession.mockResolvedValue(null);

    expect(await fetchLiveSession(client, PERSON)).toBe(PLACEHOLDER);
  });

  it('ignores another person\'s sets and sets logged into a past workout', async () => {
    client.setQueryData(queryKeys.liveSession(PERSON), PLACEHOLDER);
    queueSet('optimistic-other', { personId: 8 });
    queueSet('optimistic-past', { mode: 'session', sessionId: 42 });
    getLiveSession.mockResolvedValue(null);

    expect(await fetchLiveSession(client, PERSON)).toBeNull();
  });

  // A definitive 4xx ended that write for good, so it is not a workout in progress.
  it('ignores a set the server refused', async () => {
    client.setQueryData(queryKeys.liveSession(PERSON), PLACEHOLDER);
    await queueSet('optimistic-refused', {}, () => Promise.reject(Object.assign(new Error('bad'), { status: 400 })));
    getLiveSession.mockResolvedValue(null);

    expect(await fetchLiveSession(client, PERSON)).toBeNull();
  });

  it('lets a failed fetch fail, as before', async () => {
    client.setQueryData(queryKeys.liveSession(PERSON), PLACEHOLDER);
    queueSet('optimistic-a');
    getLiveSession.mockRejectedValue(new Error('offline'));

    await expect(fetchLiveSession(client, PERSON)).rejects.toThrow('offline');
  });
});
