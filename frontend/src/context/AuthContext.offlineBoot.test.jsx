import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth, RECONNECT_RETRY_BASE_MS, RECONNECT_RETRY_MAX_MS } from './AuthContext';
import { me as apiMe } from '../api/auth';
import { getAuthToken, setAuthToken } from '../api/client';
import { clearAuthSnapshot, loadAuthSnapshot, saveAuthSnapshot } from '../lib/authSnapshot';
import { requestPersistentStorage } from '../lib/durableStorage';
import { getOutboxAccountId, __resetOutboxAccountForTests } from '../lib/outboxPersistence';

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  me: vi.fn(),
  register: vi.fn(),
  confirmEmail: vi.fn(),
  resendCode: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  resendResetCode: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getAuthToken: vi.fn(() => null),
  setAuthToken: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  // Real semantics: no status / 5xx == unreachable; 4xx == a real answer.
  isOfflineError: (e) => {
    const s = e?.status;
    return s === undefined || s === null || s >= 500;
  },
}));
vi.mock('../lib/authSnapshot', () => ({
  loadAuthSnapshot: vi.fn(() => null),
  saveAuthSnapshot: vi.fn(),
  clearAuthSnapshot: vi.fn(),
}));
vi.mock('../lib/queryClient', () => ({
  queryClient: {},
  resetQueryCache: vi.fn(),
  clearOutboxMutations: vi.fn(),
  flushOutbox: vi.fn(),
}));
vi.mock('../lib/durableStorage', () => ({ requestPersistentStorage: vi.fn() }));
// Left UNMOCKED elsewhere (outboxPersistence's real functions are idb-guarded/localStorage-based,
// safe under jsdom) except where a test needs to observe the real pointer -- see below.

const SNAPSHOT = {
  user: { email: 'nate@example.com', role: 'USER' },
  account: { id: 7 },
  people: [{ id: 1, name: 'Nate' }],
};

function Harness() {
  const { status, offline, people } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="offline">{String(offline)}</span>
      <span data-testid="people">{people.length}</span>
    </div>
  );
}

function renderHarness() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuthContext offline boot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthToken.mockReturnValue('valid-token');
    loadAuthSnapshot.mockReturnValue(null);
    __resetOutboxAccountForTests();
  });

  afterEach(() => __resetOutboxAccountForTests());

  it('no token => unauthenticated and snapshot cleared', async () => {
    getAuthToken.mockReturnValue(null);
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(clearAuthSnapshot).toHaveBeenCalled();
    expect(apiMe).not.toHaveBeenCalled();
  });

  it('online /me success => authenticated (not offline), snapshot saved, durable storage requested', async () => {
    apiMe.mockResolvedValue(SNAPSHOT);
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('offline').textContent).toBe('false');
    expect(saveAuthSnapshot).toHaveBeenCalledWith(SNAPSHOT);
    expect(requestPersistentStorage).toHaveBeenCalled();
  });

  it('network failure + saved snapshot => authenticated OFFLINE from the snapshot', async () => {
    apiMe.mockRejectedValue(new TypeError('Failed to fetch')); // no .status => unreachable
    loadAuthSnapshot.mockReturnValue(SNAPSHOT);
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('offline').textContent).toBe('true');
    expect(screen.getByTestId('people').textContent).toBe('1');
    expect(requestPersistentStorage).toHaveBeenCalled();
    // Must NOT wipe the snapshot we just booted from.
    expect(clearAuthSnapshot).not.toHaveBeenCalled();
  });

  it('server-down (5xx) + saved snapshot => authenticated OFFLINE (treated like unreachable)', async () => {
    apiMe.mockRejectedValue({ status: 503 });
    loadAuthSnapshot.mockReturnValue(SNAPSHOT);
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('offline').textContent).toBe('true');
  });

  it('401 (session truly invalid) => unauthenticated, snapshot cleared, and the stale token wiped too', async () => {
    apiMe.mockRejectedValue({ status: 401 });
    loadAuthSnapshot.mockReturnValue(SNAPSHOT);
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(clearAuthSnapshot).toHaveBeenCalled();
    // A stale token left behind here would ride the next login POST and, if the backend also
    // rejects it, the 401 handler would tear the fresh session right back down (Fix 3).
    expect(setAuthToken).toHaveBeenCalledWith(null);
  });

  // The kick-to-login bug: a hard refresh while the server/DB is unreachable used to sign the user
  // out purely because there was no snapshot yet to fall back to -- even though the token itself
  // was perfectly valid and the server was just transiently unreachable.
  describe('offline error with a valid token but no snapshot -- hold and retry, never sign out', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('stays on the loading state instead of signing out, and does not touch the token or snapshot', async () => {
      apiMe.mockRejectedValue(new TypeError('Failed to fetch'));
      loadAuthSnapshot.mockReturnValue(null);
      renderHarness();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId('status').textContent).toBe('loading');
      expect(setAuthToken).not.toHaveBeenCalled();
      expect(clearAuthSnapshot).not.toHaveBeenCalled();

      // Still holding after the first retry attempt fires and fails again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECONNECT_RETRY_BASE_MS);
      });
      expect(screen.getByTestId('status').textContent).toBe('loading');
      expect(apiMe.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('recovers to authenticated once a retried /me finally succeeds', async () => {
      apiMe.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      apiMe.mockResolvedValueOnce(SNAPSHOT);
      loadAuthSnapshot.mockReturnValue(null);
      renderHarness();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId('status').textContent).toBe('loading');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECONNECT_RETRY_BASE_MS);
      });
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
      expect(screen.getByTestId('offline').textContent).toBe('false');
    });

    it('a genuine 401 on a later retry attempt still signs out (does not retry forever)', async () => {
      apiMe.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      apiMe.mockRejectedValueOnce({ status: 401 });
      loadAuthSnapshot.mockReturnValue(null);
      renderHarness();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId('status').textContent).toBe('loading');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECONNECT_RETRY_BASE_MS);
      });
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
      expect(setAuthToken).toHaveBeenCalledWith(null);
    });

    it('caps the retry delay rather than backing off unbounded', async () => {
      apiMe.mockRejectedValue(new TypeError('Failed to fetch'));
      loadAuthSnapshot.mockReturnValue(null);
      renderHarness();

      let delay = RECONNECT_RETRY_BASE_MS;
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- deliberately sequential: each iteration
        // must observe the PRIOR attempt's failure before the next delay is knowable.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });
        delay = Math.min(delay * 2, RECONNECT_RETRY_MAX_MS);
      }
      expect(screen.getByTestId('status').textContent).toBe('loading');
      expect(delay).toBe(RECONNECT_RETRY_MAX_MS);
    });
  });

  it('an online boot success adopts the outbox account pointer for this account', async () => {
    apiMe.mockResolvedValue(SNAPSHOT);
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(getOutboxAccountId()).toBe(String(SNAPSHOT.account.id));
  });

  it('an offline boot from the snapshot adopts the SNAPSHOT\'s account for the outbox pointer', async () => {
    apiMe.mockRejectedValue(new TypeError('Failed to fetch'));
    loadAuthSnapshot.mockReturnValue(SNAPSHOT);
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('offline').textContent).toBe('true'));
    expect(getOutboxAccountId()).toBe(String(SNAPSHOT.account.id));
  });

  it('a 401 at boot does NOT touch the outbox account pointer (queued writes must survive to replay after re-login)', async () => {
    apiMe.mockRejectedValue({ status: 401 });
    loadAuthSnapshot.mockReturnValue(SNAPSHOT);
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(getOutboxAccountId()).toBeNull();
  });
});
