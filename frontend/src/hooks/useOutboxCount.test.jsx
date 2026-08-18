import { MutationObserver, QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { getQueuedWriteCount, getUnsyncedWriteCount, useOutboxCount } from './useOutboxCount';
import { LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from '../lib/queryClient';
import { logLiveSet } from '../api/sets';

vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
  listSessionSets: vi.fn(),
}));

function newClient() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerOfflineMutationDefaults(client, { retry: false });
  return client;
}

function dispatchLogSet(client) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer
    .mutate({ mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: `k${Math.random()}`, clientLoggedAt: 't' })
    .catch(() => {});
}

describe('getQueuedWriteCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    onlineManager.setOnline(true);
  });
  afterEach(() => onlineManager.setOnline(true));

  it('is 0 with no queued writes', () => {
    expect(getQueuedWriteCount(newClient())).toBe(0);
  });

  it('counts writes paused offline, and drops back to 0 once they drain on reconnect', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client);
    dispatchLogSet(client);
    await vi.waitFor(() => expect(getQueuedWriteCount(client)).toBe(2));

    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    expect(getQueuedWriteCount(client)).toBe(0);
  });

  it('counts a write that has terminal-errored, not just a paused one', async () => {
    const client = newClient();
    logLiveSet.mockRejectedValueOnce({ status: 500 });
    dispatchLogSet(client);
    await vi.waitFor(() => expect(getQueuedWriteCount(client)).toBe(1));
  });

  it('does not count a brand-new online write during its normal fast first attempt (no banner flash)', async () => {
    const client = newClient();
    logLiveSet.mockReturnValue(new Promise(() => {})); // never resolves -- first attempt still in flight
    dispatchLogSet(client);
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    expect(getQueuedWriteCount(client)).toBe(0);
  });
});

// The SAFETY counterpart. Every case below is the same scenario as one above -- the point is
// precisely where the two answers differ, so they are kept adjacent rather than in their own file.
describe('getUnsyncedWriteCount (the logout data-loss guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
    onlineManager.setOnline(true);
  });
  afterEach(() => onlineManager.setOnline(true));

  it('is 0 with no queued writes', () => {
    expect(getUnsyncedWriteCount(newClient())).toBe(0);
  });

  // THE case this function exists for, and the exact scenario the display count above returns 0
  // for. A write on the wire has not reached the server, and logout throws away both the in-memory
  // outbox and its persisted copy -- so if that request fails there is nothing left to retry from.
  it('counts a write still in flight on its first attempt -- the one the banner deliberately ignores', async () => {
    const client = newClient();
    logLiveSet.mockReturnValue(new Promise(() => {})); // never resolves -- first attempt still in flight
    dispatchLogSet(client);
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalled());

    expect(getUnsyncedWriteCount(client)).toBe(1);
    // Pinned side by side: this divergence is the whole point, not an inconsistency to unify.
    expect(getQueuedWriteCount(client)).toBe(0);
  });

  it('counts writes paused offline, exactly like the display count', async () => {
    const client = newClient();
    onlineManager.setOnline(false);
    dispatchLogSet(client);
    dispatchLogSet(client);
    await vi.waitFor(() => expect(getUnsyncedWriteCount(client)).toBe(2));
  });

  it('drops to 0 once the write genuinely succeeds', async () => {
    const client = newClient();
    dispatchLogSet(client);
    await vi.waitFor(() => expect(getUnsyncedWriteCount(client)).toBe(0));
  });

  // A definitive 4xx is the server's real answer and onError has already rolled the write back --
  // there is nothing left to lose, so warning about it would be a false alarm on every logout for
  // the rest of the session. Same carve-out isUnsyncedWrite makes for every screen.
  it('does not count a write the server definitively rejected', async () => {
    const client = newClient();
    logLiveSet.mockRejectedValue({ status: 400 });
    dispatchLogSet(client);
    await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    await vi.waitFor(() => expect(getUnsyncedWriteCount(client)).toBe(0));
  });
});

// Same mechanism as useSessionEntries.test.jsx's scheduling case -- see the long comment there.
// This hook drives the offline banner's "N changes waiting to sync" count and is mounted app-wide,
// above every screen, so it is the most exposed of the three to a descendant's render.
describe('useOutboxCount mutation-cache notification scheduling', () => {
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
          dispatchLogSet(client);
        }
        return null;
      }
      // Child mounts only on the second render, once the parent's subscription is live.
      function Parent({ showChild }) {
        useOutboxCount();
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
