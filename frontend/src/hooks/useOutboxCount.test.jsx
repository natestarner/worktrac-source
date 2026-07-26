import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getQueuedWriteCount } from './useOutboxCount';
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
