import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionRecap } from './useSessionRecap';
import { LOG_SET_MUTATION_KEY, DELETE_SET_MUTATION_KEY, registerOfflineMutationDefaults } from '../lib/queryClient';
import { queryKeys } from '../api/queryKeys';
import { logLiveSet } from '../api/sets';

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

const PERSON = 7;
const SESSION_ID = 55;
const STARTED_AT = '2026-09-03T18:00:00.000Z';

function newClient() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  registerOfflineMutationDefaults(client, { retry: false });
  return client;
}

function seed(client, { sessionId = SESSION_ID, entries = [] } = {}) {
  client.setQueryData(queryKeys.liveSession(PERSON), { id: sessionId, startedAt: STARTED_AT });
  client.setQueryData(queryKeys.history(PERSON), [{ id: sessionId, startedAt: STARTED_AT, entries }]);
}

async function logSet(client, { exerciseId, clientLoggedAt = '2026-09-03T18:05:00.000Z' }) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  await observer
    .mutate({
      mode: 'live',
      personId: PERSON,
      exerciseId,
      weight: 135,
      reps: 5,
      unit: 'lb',
      idempotencyKey: `k-${exerciseId}-${clientLoggedAt}`,
      clientLoggedAt,
      tempId: `temp-${exerciseId}-${clientLoggedAt}`,
    })
    .catch(() => {});
}

async function dispatchDeleteSet(client, { setId, exerciseId, sessionId = SESSION_ID }) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(DELETE_SET_MUTATION_KEY),
    mutationKey: DELETE_SET_MUTATION_KEY,
  });
  await observer.mutate({ setId, personId: PERSON, exerciseId, sessionId }).catch(() => {});
}

function renderRecap(client) {
  return renderHook(() => useSessionRecap(PERSON), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe('useSessionRecap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logLiveSet.mockResolvedValue({
      isPR: false,
      best: null,
      // startedAt included deliberately: LOG_SET's onSettled promotes this response into the
      // liveSession cache, so a session without it blanks the very field the staleness scope
      // reads -- which is exactly how this test first failed.
      session: { id: SESSION_ID, startedAt: STARTED_AT },
      set: { id: 1 },
    });
  });

  it('counts what the server already knows about', () => {
    const client = newClient();
    seed(client, {
      entries: [
        { exerciseId: 1, exerciseName: 'Bench', sets: [{ id: 1 }, { id: 2 }] },
        { exerciseId: 2, exerciseName: 'Squat', sets: [{ id: 3 }] },
      ],
    });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 2, setCount: 3 });
  });

  // THE REGRESSION. Online, a set leaves the unsynced set the moment its write succeeds, while
  // `history` only catches up on the refetch the invalidation triggers. The first implementation
  // read only unsynced writes, so in that window it counted ZERO -- and the recap silently fell
  // back to the plain "Workout ended." sentence.
  //
  // Locally the refetch lands in milliseconds and this almost never lost; against lower it lost
  // every time. parity-session-recap failed all three attempts in [online] while all three degraded
  // modes passed.
  it('counts sets whose write has SUCCEEDED but which history has not caught up with yet', async () => {
    const client = newClient();
    seed(client, { entries: [] }); // history still shows the pre-set session

    await logSet(client, { exerciseId: 1 });
    await logSet(client, { exerciseId: 1, clientLoggedAt: '2026-09-03T18:06:00.000Z' });
    await logSet(client, { exerciseId: 2, clientLoggedAt: '2026-09-03T18:07:00.000Z' });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 2, setCount: 3 });
  });

  // A max per exercise, not a sum -- otherwise the moment history catches up the recap doubles.
  it('never double-counts a set present in BOTH sources', async () => {
    const client = newClient();
    await logSet(client, { exerciseId: 1 });
    seed(client, { entries: [{ exerciseId: 1, exerciseName: 'Bench', sets: [{ id: 1 }] }] });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 1, setCount: 1 });
  });

  // The partial case an either/or fallback gets wrong: two of three sets have landed in history.
  it('takes the larger source per exercise when history is partially caught up', async () => {
    const client = newClient();
    await logSet(client, { exerciseId: 1 });
    await logSet(client, { exerciseId: 1, clientLoggedAt: '2026-09-03T18:06:00.000Z' });
    await logSet(client, { exerciseId: 1, clientLoggedAt: '2026-09-03T18:07:00.000Z' });
    seed(client, { entries: [{ exerciseId: 1, exerciseName: 'Bench', sets: [{ id: 1 }, { id: 2 }] }] });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 1, setCount: 3 });
  });

  // A mutation from an earlier workout can still be in the cache until it is collected. Without the
  // clientLoggedAt scope, last night's sets would be counted into this morning's workout.
  it('ignores mutations logged before this session started', async () => {
    const client = newClient();
    seed(client, { entries: [] });

    await logSet(client, { exerciseId: 9, clientLoggedAt: '2026-09-02T19:00:00.000Z' });
    await logSet(client, { exerciseId: 1, clientLoggedAt: '2026-09-03T18:05:00.000Z' });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 1, setCount: 1 });
  });

  // Offline, a live session has no server id at all, so `history` can never match -- the mutations
  // are the only source, and they carry sessionId: null for the whole outage.
  it('still counts while the session has no server id yet', async () => {
    const client = newClient();
    client.setQueryData(queryKeys.liveSession(PERSON), { id: null, startedAt: STARTED_AT });
    client.setQueryData(queryKeys.history(PERSON), []);

    await logSet(client, { exerciseId: 1 });
    await logSet(client, { exerciseId: 2, clientLoggedAt: '2026-09-03T18:06:00.000Z' });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 2, setCount: 2 });
  });

  // THE BUG REPORT: log some sets, delete them all, end the workout. Deleting nets against the
  // mutation-cache fallback, not just against history -- otherwise the LOG_SET mutations (which
  // already succeeded, which is the whole reason they're counted at all) keep counting forever.
  // History is left stale here (still `[]`) to reproduce the exact shape of the bug: the recap has
  // to net the delete out of the PENDING count, because there is no fresher server count to fall
  // back on yet.
  it('reports nothing for sets that were logged and then deleted, before history catches up', async () => {
    const client = newClient();
    seed(client, { entries: [] });

    logLiveSet.mockResolvedValueOnce({ isPR: false, best: null, session: { id: SESSION_ID, startedAt: STARTED_AT }, set: { id: 101 } });
    await logSet(client, { exerciseId: 1 });
    logLiveSet.mockResolvedValueOnce({ isPR: false, best: null, session: { id: SESSION_ID, startedAt: STARTED_AT }, set: { id: 102 } });
    await logSet(client, { exerciseId: 1, clientLoggedAt: '2026-09-03T18:06:00.000Z' });

    await dispatchDeleteSet(client, { setId: 101, exerciseId: 1 });
    await dispatchDeleteSet(client, { setId: 102, exerciseId: 1 });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 0, setCount: 0 });
  });

  // The same netting, but against a server count that HAS caught up (history already reflects the
  // delete) -- the surviving set must still be counted, deleting one must not zero the exercise out.
  it('nets a delete against history once it has caught up, keeping the surviving set', async () => {
    const client = newClient();
    seed(client, { entries: [{ exerciseId: 1, exerciseName: 'Bench', sets: [{ id: 201 }, { id: 202 }] }] });

    await dispatchDeleteSet(client, { setId: 201, exerciseId: 1 });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 1, setCount: 1 });
  });

  // A delete of every set for an exercise must drop the exercise from the count entirely, not
  // leave it in as a zero -- exerciseCount is the number of exercises actually touched.
  it('drops an exercise from exerciseCount once every one of its sets is deleted', async () => {
    const client = newClient();
    seed(client, {
      entries: [
        { exerciseId: 1, exerciseName: 'Bench', sets: [{ id: 301 }] },
        { exerciseId: 2, exerciseName: 'Squat', sets: [{ id: 302 }] },
      ],
    });

    await dispatchDeleteSet(client, { setId: 301, exerciseId: 1 });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 1, setCount: 1 });
  });

  // A set deleted while its create was still on the wire (offlineSetEdits.js's deleteQueuedSet):
  // the DELETE_SET targets the create's tempId, because no real id exists yet. The create is still
  // counted as pending, so the recap has to recognise the delete by that tempId -- or "log a set,
  // remove it mid-save, end the workout" reports the removed set.
  it('reports nothing for a set deleted by its tempId while its create is still in flight', async () => {
    const client = newClient();
    seed(client, { entries: [] });
    logLiveSet.mockReturnValueOnce(new Promise(() => {}));
    logSet(client, { exerciseId: 1 });
    // Not awaited: it queues behind the create, which never settles here.
    dispatchDeleteSet(client, { setId: 'temp-1-2026-09-03T18:05:00.000Z', exerciseId: 1, sessionId: null });

    const { result } = renderRecap(client);
    expect(result.current).toMatchObject({ exerciseCount: 0, setCount: 0 });
  });
});
