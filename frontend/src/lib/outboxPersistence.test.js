// A real (in-memory) IndexedDB so the outbox's actual persist/restore path is exercised, not no-oped.
// Imported first so `indexedDB` is defined before the modules under test read `typeof indexedDB`.
import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachOutboxPersistence,
  clearOutbox,
  getOutboxAccountId,
  persistOutboxNow,
  restoreOutbox,
  setOutboxAccountId,
  __resetOutboxAccountForTests,
} from './outboxPersistence';
import { CREATE_EXERCISE_MUTATION_KEY, LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from './queryClient';
import { clearExerciseIdMap, newTempExerciseId } from './exerciseIdMap';
import { logLiveSet } from '../api/sets';
import { addExercise, favoriteExercise } from '../api/exercises';
import { setAuthToken } from '../api/client';

vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
  listSessionSets: vi.fn(),
}));
vi.mock('../api/exercises', () => ({
  addExercise: vi.fn(),
  favoriteExercise: vi.fn(),
  updateExercise: vi.fn(),
  listExercises: vi.fn(),
}));

const ACCOUNT = 'acct-1';
const LEGACY_OUTBOX_KEY = 'worktrac-outbox';

function keyFor(accountId) {
  return `worktrac-outbox:${accountId}`;
}

function newClient() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerOfflineMutationDefaults(client, { retry: false });
  return client;
}

// Fire a log-set mutation through the registered defaults (so it carries the outbox scope + fn).
function dispatchLogSet(client, variables) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer.mutate(variables).catch(() => {});
  return observer;
}

function liveSetVars(overrides = {}) {
  return {
    mode: 'live',
    personId: 7,
    sessionId: null,
    exerciseId: 1,
    unit: 'lb',
    weight: 135,
    reps: 8,
    tempId: `optimistic-${Math.random()}`,
    idempotencyKey: `key-${Math.random()}`,
    clientLoggedAt: '2026-07-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('offline outbox persistence', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    await clearOutbox(ACCOUNT);
    await clearExerciseIdMap();
    onlineManager.setOnline(true);
    // restoreOutbox's immediate re-dispatch of not-paused writes is gated on an authenticated
    // session (see below) -- these tests are all exercising the REPLAY mechanics assuming a
    // logged-in user; the no-token gate itself is covered in its own describe block.
    setAuthToken('test-token');
  });

  afterEach(async () => {
    onlineManager.setOnline(true);
    __resetOutboxAccountForTests();
    await clearExerciseIdMap();
    setAuthToken(null);
  });

  it('persists a queued (offline-paused) write and replays it on a fresh client after restore', async () => {
    const client1 = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client1, liveSetVars({ idempotencyKey: 'idem-1' }));
    await vi.waitFor(() =>
      expect(client1.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );

    await persistOutboxNow(client1, ACCOUNT);
    const stored = await get(keyFor(ACCOUNT));
    expect(stored.mutations).toHaveLength(1);

    // Simulate an app restart: a brand-new client restores the outbox from IndexedDB and replays.
    const client2 = newClient();
    await restoreOutbox(client2, ACCOUNT);
    expect(client2.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1);

    onlineManager.setOnline(true);
    await client2.resumePausedMutations();

    expect(logLiveSet).toHaveBeenCalledTimes(1);
    expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ exerciseId: 1, idempotencyKey: 'idem-1' }));
  });

  it('replays queued writes strictly in enqueue order', async () => {
    const client1 = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client1, liveSetVars({ reps: 5, idempotencyKey: 'first' }));
    dispatchLogSet(client1, liveSetVars({ reps: 6, idempotencyKey: 'second' }));
    await vi.waitFor(() =>
      expect(client1.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(2),
    );
    await persistOutboxNow(client1, ACCOUNT);

    const client2 = newClient();
    await restoreOutbox(client2, ACCOUNT);
    onlineManager.setOnline(true);
    await client2.resumePausedMutations();

    const keysInOrder = logLiveSet.mock.calls.map(([, payload]) => payload.idempotencyKey);
    expect(keysInOrder).toEqual(['first', 'second']);
  });

  // Regression test: the two cohorts used to be registered as two separate batches -- every
  // PAUSED write hydrated first, THEN every not-paused write dispatched -- rather than one pass
  // merged by true submittedAt. Under lie-fi (navigator.onLine stays true), an actively-retrying
  // write is never "paused", so an earlier-submitted write that's mid-retry could end up
  // registered into the shared outbox scope AFTER a later-submitted write that happened to be
  // genuinely paused -- reversing their real order.
  it('replays an earlier-submitted, not-paused (mid-retry) write before a later-submitted, paused one -- the mixed-cohort case', async () => {
    const client1 = newClient();

    // Submitted first, but stays mid-retry (not paused) rather than settling -- lie-fi.
    logLiveSet.mockReturnValueOnce(new Promise(() => {}));
    dispatchLogSet(client1, liveSetVars({ reps: 5, idempotencyKey: 'earlier-not-paused' }));
    await vi.waitFor(() => {
      const [mutation] = client1.getMutationCache().getAll();
      expect(mutation.state.status).toBe('pending');
      expect(mutation.state.isPaused).toBe(false);
    });

    // Submitted second, but genuinely offline -- paused.
    onlineManager.setOnline(false);
    dispatchLogSet(client1, liveSetVars({ reps: 6, idempotencyKey: 'later-paused' }));
    await vi.waitFor(() => {
      const paused = client1.getMutationCache().getAll().filter((m) => m.state.isPaused);
      expect(paused).toHaveLength(1);
    });

    await persistOutboxNow(client1, ACCOUNT);

    // Reload: a fresh client restores the outbox, then connectivity returns for real. Clear the
    // call log first -- the still-hanging client1 attempt above already recorded one call, and we
    // only care about the replay order client2 actually produces.
    logLiveSet.mockClear();
    const client2 = newClient();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    await restoreOutbox(client2, ACCOUNT);
    onlineManager.setOnline(true);
    await client2.resumePausedMutations();

    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalledTimes(2));
    const keysInOrder = logLiveSet.mock.calls.map(([, payload]) => payload.idempotencyKey);
    expect(keysInOrder).toEqual(['earlier-not-paused', 'later-paused']);
  });

  // Proves the SORT itself, not just that already-ordered input stays ordered: the persisted
  // mutation array's stored order (dispatch/registration order) is the OPPOSITE of the two
  // writes' true enqueueSeq -- restoreOutbox must actively re-order them, not merely preserve
  // whatever order they happened to arrive in.
  it('restoreOutbox re-orders a persisted outbox whose stored array order disagrees with enqueueSeq (proves the sort, not just pass-through)', async () => {
    const client1 = newClient();
    onlineManager.setOnline(false);
    // Registered into the mutation cache in THIS order (enqueueSeq 2 first, enqueueSeq 1 second) --
    // the opposite of true enqueue order, simulating a scrambled persisted array.
    dispatchLogSet(client1, liveSetVars({ idempotencyKey: 'true-second', enqueueSeq: 2 }));
    dispatchLogSet(client1, liveSetVars({ idempotencyKey: 'true-first', enqueueSeq: 1 }));
    await vi.waitFor(() =>
      expect(client1.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(2),
    );
    await persistOutboxNow(client1, ACCOUNT);

    const client2 = newClient();
    await restoreOutbox(client2, ACCOUNT);
    onlineManager.setOnline(true);
    await client2.resumePausedMutations();

    const keysInOrder = logLiveSet.mock.calls.map(([, payload]) => payload.idempotencyKey);
    expect(keysInOrder).toEqual(['true-first', 'true-second']);
  });

  // Regression test for the exact bug reported in production: a write's `submittedAt` gets
  // RE-STAMPED to "now" every time it's re-executed (see queryClient.js's flushOutbox comment and
  // outboxSequence.js). Before enqueueSeq existed, restoreOutbox's re-dispatch of a not-paused
  // (lie-fi) write didn't preserve its original submittedAt, so after ONE reload that write's
  // submittedAt no longer reflected true enqueue time. A SECOND reload's submittedAt-sort would
  // then get the order wrong -- reversing a create ahead of the set that depends on it, deadlocking
  // the set forever (requireResolvedExerciseId throws a retryable error against an unresolved temp
  // id, forever). enqueueSeq lives in `variables`, which a re-dispatch never touches, so it survives
  // any number of reloads unchanged -- this test simulates exactly that: two reload cycles under a
  // continuous lie-fi window, with the create staying actively-retrying (not paused) through both.
  it('survives TWO reload cycles under lie-fi: a create that keeps getting re-dispatched (re-stamping submittedAt) never loses its correct position ahead of the set that depends on it', async () => {
    const tempId = newTempExerciseId();

    function dispatch(client, mutationKey, variables) {
      const observer = new MutationObserver(client, { ...client.getMutationDefaults(mutationKey), mutationKey });
      observer.mutate(variables).catch(() => {});
    }

    // Enqueued first (enqueueSeq: 1). Lie-fi: navigator.onLine stays true, so it hangs mid-retry --
    // never paused -- exactly the cohort restoreOutbox must re-dispatch (not hydrate) on every reload.
    addExercise.mockReturnValue(new Promise(() => {}));
    const client1 = newClient();
    dispatch(client1, CREATE_EXERCISE_MUTATION_KEY, { tempId, name: 'Zercher Squat', personId: 7, idempotencyKey: 'ex-key', enqueueSeq: 1 });
    await vi.waitFor(() => {
      const [mutation] = client1.getMutationCache().getAll();
      expect(mutation.state.status).toBe('pending');
      expect(mutation.state.isPaused).toBe(false);
    });

    // Enqueued second (enqueueSeq: 2), against the not-yet-synced exercise. Genuinely offline, so
    // it pauses.
    onlineManager.setOnline(false);
    dispatch(client1, LOG_SET_MUTATION_KEY, {
      mode: 'live', personId: 7, exerciseId: tempId, weight: 185, reps: 5,
      idempotencyKey: 'set-key', clientLoggedAt: 't', enqueueSeq: 2,
    });
    await vi.waitFor(() => {
      const setMutation = client1.getMutationCache().getAll().find((m) => m.options.mutationKey[0] === 'logSet');
      expect(setMutation.state.isPaused).toBe(true);
    });
    await persistOutboxNow(client1, ACCOUNT);

    // Back online (true lie-fi: navigator.onLine reports true, only the backend is unreachable) --
    // otherwise canFetch's networkMode check alone would force EVERY re-dispatch paused regardless
    // of scope contention, masking the thing this test actually exercises.
    onlineManager.setOnline(true);

    // Reload #1: a fresh client restores. The create is not-paused at persist time, so it's
    // re-dispatched fresh here -- its submittedAt gets re-stamped to "now" (still hanging, per the
    // same addExercise mock). The set is restored via hydrate (paused, submittedAt untouched).
    const client2 = newClient();
    await restoreOutbox(client2, ACCOUNT);
    await vi.waitFor(() => {
      const created = client2.getMutationCache().getAll().find((m) => m.options.mutationKey[0] === 'createExercise');
      expect(created.state.status).toBe('pending');
      expect(created.state.isPaused).toBe(false);
    });
    // The create's own enqueueSeq (1) is preserved unchanged through the re-dispatch -- only
    // submittedAt drifts (execute()'s normal 'pending' dispatch re-stamps it to "now"; not asserted
    // here numerically since two dispatches this close together can land in the same millisecond,
    // which would make a strict comparison flaky without changing what's actually being proven).
    const [createAfterReload1] = client2.getMutationCache().getAll().filter((m) => m.options.mutationKey[0] === 'createExercise');
    expect(createAfterReload1.state.variables.enqueueSeq).toBe(1);
    await persistOutboxNow(client2, ACCOUNT);

    // Reload #2: the create's submittedAt has already drifted once (reload #1's re-dispatch
    // re-stamps it). A submittedAt-based sort could now register the set (small, stable
    // submittedAt) ahead of the create (drifted submittedAt) -- the deadlock this test guards
    // against. enqueueSeq (1 vs 2, untouched by any of this) must still sort the create first.
    // Connectivity genuinely returns to the backend here too (addExercise now resolves), so THIS
    // restore's re-dispatch of the create is what actually completes it.
    addExercise.mockResolvedValue({ id: 4242, name: 'Zercher Squat', isGlobal: false });
    favoriteExercise.mockResolvedValue({});
    const client3 = newClient();
    await restoreOutbox(client3, ACCOUNT);
    await client3.resumePausedMutations();

    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    expect(favoriteExercise).toHaveBeenCalledWith(7, 4242);
    expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ exerciseId: 4242, idempotencyKey: 'set-key' }));
  });

  // Mode-TRANSITION variant of the mixed-cohort case above: rather than one write starting life
  // not-paused (dispatched while already online/lie-fi) and the other starting paused, BOTH are
  // enqueued while genuinely hard-offline (both paused from the moment they're dispatched), and
  // connectivity only later drifts to lie-fi -- resuming the head write (which starts retrying
  // against the unreachable backend, so it's no longer paused) while the write behind it in the
  // shared scope stays paused, still waiting its turn. This is the shape a real device's
  // connectivity actually takes (offline -> lie-fi -> reload), not just the two static starting
  // cohorts the original regression covered.
  it('survives a genuine offline -> lie-fi connectivity drift: both writes start paused, then only the head resumes (not the one behind it), and a reload still replays them in true order', async () => {
    const client1 = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client1, liveSetVars({ reps: 5, idempotencyKey: 'drift-earlier', enqueueSeq: 1 }));
    dispatchLogSet(client1, liveSetVars({ reps: 6, idempotencyKey: 'drift-later', enqueueSeq: 2 }));
    await vi.waitFor(() =>
      expect(client1.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(2),
    );

    // Connectivity drifts to lie-fi: navigator.onLine reports true again, but the backend is still
    // unreachable. Resuming now only unblocks the HEAD of the scope (the earlier write) -- it starts
    // retrying (hangs here, simulating an unreachable backend) -- while the later write remains
    // paused behind it, since the scope only lets one write run at a time.
    onlineManager.setOnline(true);
    logLiveSet.mockReturnValueOnce(new Promise(() => {}));
    // Not awaited -- the head write hangs forever (simulating lie-fi), so the returned promise
    // (which resolves only once every resumed write settles) would never settle either.
    client1.resumePausedMutations().catch(() => {});
    await vi.waitFor(() => {
      const earlier = client1.getMutationCache().getAll().find((m) => m.state.variables.idempotencyKey === 'drift-earlier');
      const later = client1.getMutationCache().getAll().find((m) => m.state.variables.idempotencyKey === 'drift-later');
      expect(earlier.state.isPaused).toBe(false);
      expect(later.state.isPaused).toBe(true);
    });

    await persistOutboxNow(client1, ACCOUNT);

    // Reload: a fresh client restores. "drift-earlier" was not-paused at persist time, so it's
    // re-dispatched fresh (re-stamping its submittedAt); "drift-later" is restored untouched via
    // hydrate. Real connectivity now returns for good.
    logLiveSet.mockClear();
    const client2 = newClient();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    await restoreOutbox(client2, ACCOUNT);
    onlineManager.setOnline(true);
    await client2.resumePausedMutations();

    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalledTimes(2));
    const keysInOrder = logLiveSet.mock.calls.map(([, payload]) => payload.idempotencyKey);
    expect(keysInOrder).toEqual(['drift-earlier', 'drift-later']);
  });

  it('eagerly persists on enqueue via the mutation-cache subscription', async () => {
    const client = newClient();
    const detach = attachOutboxPersistence(client, ACCOUNT);
    onlineManager.setOnline(false);
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'eager' }));

    // No explicit persist call -- the subscription must have written it as soon as it paused.
    await vi.waitFor(async () => {
      const stored = await get(keyFor(ACCOUNT));
      expect(stored?.mutations).toHaveLength(1);
    });
    detach();
  });

  it('does NOT persist a paused mutation that lacks the outbox scope (un-replayable writes are skipped)', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    // A plain mutation with no registered defaults / no outbox scope.
    const observer = new MutationObserver(client, { mutationFn: vi.fn(), mutationKey: ['somethingElse'] });
    observer.mutate({}).catch(() => {});
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );

    await persistOutboxNow(client, ACCOUNT);
    const stored = await get(keyFor(ACCOUNT));
    expect(stored).toBeUndefined(); // nothing durable to persist -> key cleared
  });

  it('persists a write that is actively retrying online (pending, not paused) -- not just paused ones', async () => {
    const client = newClient();
    logLiveSet.mockReturnValue(new Promise(() => {})); // never resolves -- stays pending, online
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'mid-retry' }));
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalled());

    const [mutation] = client.getMutationCache().getAll();
    expect(mutation.state.isPaused).toBe(false);
    expect(mutation.state.status).toBe('pending');

    await persistOutboxNow(client, ACCOUNT);
    const stored = await get(keyFor(ACCOUNT));
    expect(stored.mutations).toHaveLength(1);
    expect(stored.mutations[0].state.status).toBe('pending');
  });

  it('persists a write that terminal-errored, and restore re-dispatches it from its variables (not hydrated as inert history)', async () => {
    const client = newClient(); // retry: false
    logLiveSet.mockRejectedValueOnce({ status: 500 });
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'errored' }));
    await vi.waitFor(() => {
      const [mutation] = client.getMutationCache().getAll();
      expect(mutation.state.status).toBe('error');
    });

    await persistOutboxNow(client, ACCOUNT);
    const stored = await get(keyFor(ACCOUNT));
    expect(stored.mutations).toHaveLength(1);
    expect(stored.mutations[0].state.status).toBe('error');

    // A fresh client (simulating a reload) restores it -- since it wasn't paused, there's no
    // "resume" for it; restoreOutbox must re-dispatch it fresh instead.
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    const client2 = newClient();
    await restoreOutbox(client2, ACCOUNT);

    await vi.waitFor(() =>
      expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ idempotencyKey: 'errored' })),
    );
  });

  it('keeps each account\'s outbox in its own key -- one account\'s writes never restore under another', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'account-a-only' }));
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );
    await persistOutboxNow(client, 'account-a');

    const client2 = newClient();
    await restoreOutbox(client2, 'account-b');
    expect(client2.getMutationCache().getAll()).toHaveLength(0);

    // Account A's own data is untouched and still restorable.
    const client3 = newClient();
    await restoreOutbox(client3, 'account-a');
    expect(client3.getMutationCache().getAll()).toHaveLength(1);
  });

  it('migrates the old single global outbox key into a per-account key once, on first restore', async () => {
    onlineManager.setOnline(false);
    const client = newClient();
    dispatchLogSet(client, liveSetVars({ idempotencyKey: 'legacy' }));
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
    );
    // Simulate data left over from before per-account keys existed, under the bare legacy key.
    const dehydrated = await (async () => {
      await persistOutboxNow(client, 'temp');
      const data = await get(keyFor('temp'));
      await clearOutbox('temp');
      return data;
    })();
    await set(LEGACY_OUTBOX_KEY, dehydrated);

    const freshClient = newClient();
    await restoreOutbox(freshClient, 'acct-migrated');

    expect(freshClient.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1);
    expect(await get(LEGACY_OUTBOX_KEY)).toBeUndefined();
    expect(await get(keyFor('acct-migrated'))).toBeDefined();
  });

  it('the outbox account pointer round-trips through localStorage', () => {
    expect(getOutboxAccountId()).toBeNull();
    setOutboxAccountId(42);
    expect(getOutboxAccountId()).toBe('42');
    __resetOutboxAccountForTests();
    expect(getOutboxAccountId()).toBeNull();
  });

  // The login-loop bug: restoreOutbox used to unconditionally re-dispatch every not-paused write
  // (mid-retry or terminal-errored at persist time) the instant it loaded -- including at app boot,
  // before AuthContext has verified anything. With no (or a since-cleared) token, that dispatch 401s
  // with no Authorization header, and that 401 can tear down a session that moments later DOES have
  // a valid token. Restore must never fire a network call without a session to replay against.
  describe('restoreOutbox requires an authenticated session to actually dispatch', () => {
    it('hydrates a terminal-errored write as PAUSED (not dispatched) when there is no auth token', async () => {
      // Persist a write left in a terminal error state, as if a prior session's queued write had
      // exhausted its retries (or 401'd) before ever being cleaned up.
      const client1 = newClient();
      logLiveSet.mockRejectedValueOnce({ status: 500 });
      dispatchLogSet(client1, liveSetVars({ idempotencyKey: 'errored-no-token' }));
      await vi.waitFor(() => {
        const [mutation] = client1.getMutationCache().getAll();
        expect(mutation.state.status).toBe('error');
      });
      await persistOutboxNow(client1, ACCOUNT);

      // Simulate a fresh boot with no session (a cleared/expired token).
      setAuthToken(null);
      logLiveSet.mockClear();
      const client2 = newClient();
      await restoreOutbox(client2, ACCOUNT);

      expect(logLiveSet).not.toHaveBeenCalled();
      const [mutation] = client2.getMutationCache().getAll();
      expect(mutation.state.isPaused).toBe(true);

      // Once a session exists again, the normal paused-resume path (flushOutbox/
      // resumePausedMutations) picks it up -- nothing was lost by holding it.
      setAuthToken('fresh-token');
      onlineManager.setOnline(true);
      await client2.resumePausedMutations();
      expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ idempotencyKey: 'errored-no-token' }));
    });

    it('hydrates an already-paused write as paused too (unchanged) when there is no auth token', async () => {
      const client1 = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client1, liveSetVars({ idempotencyKey: 'paused-no-token' }));
      await vi.waitFor(() =>
        expect(client1.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1),
      );
      await persistOutboxNow(client1, ACCOUNT);

      setAuthToken(null);
      const client2 = newClient();
      await restoreOutbox(client2, ACCOUNT);

      expect(logLiveSet).not.toHaveBeenCalled();
      expect(client2.getMutationCache().getAll().filter((m) => m.state.isPaused)).toHaveLength(1);
    });

    it('dispatches immediately as before when a token IS present (no behavior change for the common case)', async () => {
      const client1 = newClient();
      logLiveSet.mockRejectedValueOnce({ status: 500 });
      dispatchLogSet(client1, liveSetVars({ idempotencyKey: 'errored-with-token' }));
      await vi.waitFor(() => {
        const [mutation] = client1.getMutationCache().getAll();
        expect(mutation.state.status).toBe('error');
      });
      await persistOutboxNow(client1, ACCOUNT);

      logLiveSet.mockClear();
      logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
      const client2 = newClient(); // setAuthToken('test-token') is still active from beforeEach
      await restoreOutbox(client2, ACCOUNT);

      await vi.waitFor(() =>
        expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ idempotencyKey: 'errored-with-token' })),
      );
    });
  });
});
