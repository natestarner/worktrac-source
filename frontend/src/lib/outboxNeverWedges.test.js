import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EDIT_SET_MUTATION_KEY,
  LOG_SET_MUTATION_KEY,
  isDeadWrite,
  isUnsyncedWrite,
  registerOfflineMutationDefaults,
  shouldRetryWrite,
} from './queryClient';
import { clearSetIdMap } from './setIdMap';
import { editSet, logLiveSet } from '../api/sets';

vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
}));

// The single invariant this whole area exists to protect: THE QUEUE ALWAYS DRAINS.
//
// Every durable write shares one TanStack mutation scope, and TanStack lets only the first
// 'pending' mutation in a scope run. A mutation stays 'pending' for the whole of its retry loop --
// so one write that retries forever stops every write behind it, permanently, including writes
// made later while fully online. That is what the reported bug actually was, and why "the edit is
// stuck" and "the app no longer syncs anything" are the same sentence.
//
// docs/incidents/2026-09-04-outbox-wedged-by-orphaned-edit.md
describe('the outbox never wedges', () => {
  let client;

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearSetIdMap();
    onlineManager.setOnline(true);
    // Real retry policy, NOT `retry: false` -- the wedge is a property of the retry loop, so a
    // test that disables retries cannot reproduce it and would pass against the broken code.
    client = new QueryClient();
    registerOfflineMutationDefaults(client);
  });

  afterEach(async () => {
    onlineManager.setOnline(true);
    await clearSetIdMap();
  });

  function dispatchLogSet(tempId, idempotencyKey) {
    const observer = new MutationObserver(client, {
      ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
      mutationKey: LOG_SET_MUTATION_KEY,
    });
    observer
      .mutate({ mode: 'live', personId: 7, exerciseId: 3, weight: 135, reps: 5, tempId, idempotencyKey, clientLoggedAt: 't' })
      .catch(() => {});
  }

  function dispatchEditSet(setId) {
    const observer = new MutationObserver(client, {
      ...client.getMutationDefaults(EDIT_SET_MUTATION_KEY),
      mutationKey: EDIT_SET_MUTATION_KEY,
    });
    observer.mutate({ setId, weight: 140, reps: 3, personId: 7, sessionId: null, exerciseId: 3 }).catch(() => {});
  }

  function removeFromCache(predicate) {
    const cache = client.getMutationCache();
    cache.getAll().filter(predicate).forEach((m) => cache.remove(m));
  }

  // THE regression test. An edit whose create is gone can never resolve its temp id; before the
  // fix it retried forever and took the whole queue down with it. The assertion that matters is
  // NOT "the edit failed" -- it is that a write queued BEHIND it still reaches the server, which
  // is the symptom a person actually reports ("online logs get added to the list and never hit
  // the server").
  //
  // The create is removed directly rather than via cancelQueuedWritesForSet so this covers the
  // backstop on its own: cancelQueuedWritesForSet already removes the orphan edit at the source
  // (see offlineSetEdits.test.js), and if it ever misses a path -- or a create goes missing some
  // other way -- this is what keeps the queue moving.
  it('a queued edit whose set no longer exists does not block the writes behind it', async () => {
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 99 } });
    onlineManager.setOnline(false);

    dispatchLogSet('optimistic-doomed', 'k1');
    dispatchEditSet('optimistic-doomed');
    await vi.waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(2));

    // The create disappears; the edit is left pointing at a tempId nothing will ever map.
    removeFromCache((m) => m.options.mutationKey?.[0] === 'logSet');

    // A set logged afterwards -- this is the one that must still land.
    dispatchLogSet('optimistic-later', 'k2');

    onlineManager.setOnline(true);
    await client.resumePausedMutations();

    await vi.waitFor(() =>
      expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ idempotencyKey: 'k2' })),
    );
    // The doomed edit never reached the wire (a temp id is not a Long), and it settled instead of
    // spinning -- which is what freed the scope.
    expect(editSet).not.toHaveBeenCalled();
  });

  // The same shape, one step further along: the queue has to keep draining after the dead write,
  // not merely let one write past it.
  it('keeps draining every remaining write, in order, past a dead one', async () => {
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 99 } });
    onlineManager.setOnline(false);

    dispatchLogSet('optimistic-doomed', 'k1');
    dispatchEditSet('optimistic-doomed');
    removeFromCache((m) => m.options.mutationKey?.[0] === 'logSet');
    dispatchLogSet('optimistic-a', 'ka');
    dispatchLogSet('optimistic-b', 'kb');
    dispatchLogSet('optimistic-c', 'kc');

    onlineManager.setOnline(true);
    await client.resumePausedMutations();

    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalledTimes(3));
    expect(logLiveSet.mock.calls.map(([, payload]) => payload.idempotencyKey)).toEqual(['ka', 'kb', 'kc']);
  });
});

// The counterpart guarantee, and the one worth being loudest about: a backend that is down, cold,
// overloaded or timing out emits every status code there is, and NONE of them mean the write is
// bad. Nothing here may be read as "give up", badged as failed, or discarded.
describe('a failing backend never costs a queued write', () => {
  const TRANSIENT = [
    ['500 from the app', { status: 500 }],
    ['502 from the gateway', { status: 502 }],
    ['503 while the DB is down', { status: 503 }],
    ['504 from the ingress', { status: 504 }],
    ['408 request timeout', { status: 408 }],
    ['429 rate limited', { status: 429 }],
    ['an aborted 15s request (no status)', { status: undefined }],
    ['a bare rejected fetch (no status)', {}],
  ];

  it.each(TRANSIENT)('keeps retrying after %s, however many attempts have failed', (_label, error) => {
    expect(shouldRetryWrite(0, error)).toBe(true);
    expect(shouldRetryWrite(1, error)).toBe(true);
    expect(shouldRetryWrite(50, error)).toBe(true);
    expect(shouldRetryWrite(5000, error)).toBe(true);
  });

  // Because those retry, the mutation never leaves 'pending' -- so even asked about a write that
  // somehow presented as errored, none of them may be called dead.
  it.each(TRANSIENT)('never marks a write dead for %s', (_label, error) => {
    expect(isDeadWrite({ status: 'error', errorStatus: error.status })).toBe(false);
  });

  it.each(TRANSIENT)('still counts a write as unsynced after %s, so nothing discards it silently', (_label, error) => {
    expect(isUnsyncedWrite({ status: 'error', errorStatus: error.status })).toBe(true);
  });

  // A write still on the wire or waiting its turn is emphatically not dead.
  it('never marks a pending, paused or successful write dead', () => {
    expect(isDeadWrite({ status: 'pending' })).toBe(false);
    expect(isDeadWrite({ status: 'idle' })).toBe(false);
    expect(isDeadWrite({ status: 'success' })).toBe(false);
  });

  // An expired session is recoverable: a forced 401 deliberately preserves the outbox and
  // flushOutbox replays it after the next sign-in. Calling it dead would be a lie, and would offer
  // a Discard for a write that is one login away from landing.
  it('does not mark a 401 dead -- the outbox survives a forced sign-out and replays after login', () => {
    expect(isDeadWrite({ status: 'error', errorStatus: 401 })).toBe(false);
  });

  // The only two things that ARE dead: the server definitively rejected this write, or its
  // dependency can never arrive.
  it('marks a definitively-rejected write dead', () => {
    expect(isDeadWrite({ status: 'error', errorStatus: 400 })).toBe(true);
    expect(isDeadWrite({ status: 'error', errorStatus: 403 })).toBe(true);
    expect(isDeadWrite({ status: 'error', errorStatus: 404 })).toBe(true);
  });

  it('marks a write whose dependency is gone dead, regardless of status', () => {
    expect(isDeadWrite({ status: 'error', errorStatus: undefined, errorTerminal: true })).toBe(true);
    expect(shouldRetryWrite(0, { terminal: true })).toBe(false);
  });
});
