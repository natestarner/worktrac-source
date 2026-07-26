import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelPendingLogSet, replacePendingLogSet } from './offlineSetEdits';
import { LOG_SET_MUTATION_KEY, registerOfflineMutationDefaults } from './queryClient';
import { logLiveSet } from '../api/sets';

vi.mock('../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
}));

function newClient() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerOfflineMutationDefaults(client, { retry: false });
  return client;
}

function dispatchLogSet(client, overrides = {}) {
  const vars = {
    mode: 'live',
    personId: 7,
    sessionId: null,
    exerciseId: 1,
    unit: 'lb',
    weight: 135,
    reps: 5,
    tempId: 'optimistic-a',
    idempotencyKey: 'idem-a',
    clientLoggedAt: '2026-07-22T10:00:00.000Z',
    ...overrides,
  };
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer.mutate(vars).catch(() => {});
  return vars;
}

function pendingMutations(client) {
  return client.getMutationCache().getAll().filter((m) => m.state.status === 'pending');
}

describe('offlineSetEdits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    onlineManager.setOnline(true);
  });

  afterEach(() => onlineManager.setOnline(true));

  describe('cancelPendingLogSet', () => {
    it('removes the paused mutation behind an offline-logged set', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client);
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(1));

      cancelPendingLogSet(client, 'optimistic-a');

      expect(pendingMutations(client)).toHaveLength(0);
      // Cancelled outright -- never actually dispatched to the server, even after reconnect.
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      expect(logLiveSet).not.toHaveBeenCalled();
    });

    it('is a no-op when no mutation matches the tempId', () => {
      const client = newClient();
      expect(() => cancelPendingLogSet(client, 'no-such-temp-id')).not.toThrow();
    });
  });

  describe('replacePendingLogSet', () => {
    it('replaces the pending create with corrected weight/reps, preserving identity fields', async () => {
      const client = newClient();
      onlineManager.setOnline(false);
      dispatchLogSet(client, { weight: 135, reps: 5 });
      await vi.waitFor(() => expect(pendingMutations(client)).toHaveLength(1));

      const result = replacePendingLogSet(client, 'optimistic-a', { weight: 140, reps: 3 });

      expect(result).toMatchObject({
        weight: 140,
        reps: 3,
        tempId: 'optimistic-a',
        idempotencyKey: 'idem-a',
        clientLoggedAt: '2026-07-22T10:00:00.000Z',
        personId: 7,
        exerciseId: 1,
      });
      // Still exactly one pending mutation -- the old one was replaced, not left duplicated.
      expect(pendingMutations(client)).toHaveLength(1);

      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      await vi.waitFor(() => expect(logLiveSet).toHaveBeenCalledTimes(1));
      expect(logLiveSet).toHaveBeenCalledWith(7, expect.objectContaining({ weight: 140, reps: 3, idempotencyKey: 'idem-a' }));
    });

    it('returns null when no mutation matches the tempId (already synced or never existed)', () => {
      const client = newClient();
      expect(replacePendingLogSet(client, 'no-such-temp-id', { weight: 100, reps: 1 })).toBeNull();
    });
  });
});
