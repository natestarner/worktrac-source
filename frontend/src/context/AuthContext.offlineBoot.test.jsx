import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthProvider,
  useAuth,
  BOOT_STALL_AFTER_ATTEMPTS,
  RECONNECT_RETRY_BASE_MS,
  RECONNECT_RETRY_MAX_MS,
} from './AuthContext';
import { login as apiLogin, me as apiMe } from '../api/auth';
import { getAuthToken, setAuthToken } from '../api/client';
import { resetQueryCache } from '../lib/queryClient';
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
  const { status, offline, people, bootStalled, login } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="offline">{String(offline)}</span>
      <span data-testid="people">{people.length}</span>
      <span data-testid="stalled">{String(Boolean(bootStalled))}</span>
      <button onClick={() => login('nate@example.com', 'password123').catch(() => {})}>login</button>
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

  // "Hold and retry" above is right, but it used to hold with NO bound on how long the person sat
  // looking at a skeleton, and ProtectedRoute renders `loading` as exactly that. Reproduced in a
  // real browser at 81s and still going, recoverable only by clearing site data -- the "spinner
  // over a request that will never succeed" .claude/rules/resilience.md forbids. See
  // docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md.
  describe('a boot that keeps failing eventually says so, without giving up', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // Attempt 1 fires immediately; each failure schedules the next after a doubling, capped delay.
    // Tracked across calls so a follow-up run continues the real backoff rather than restarting it
    // at zero and advancing past nothing.
    let pendingDelay = 0;
    beforeEach(() => {
      pendingDelay = 0;
    });

    async function runAttempts(count) {
      for (let i = 0; i < count; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- sequential by nature: each attempt's
        // failure is what schedules the next delay.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(pendingDelay);
        });
        pendingDelay =
          pendingDelay === 0 ? RECONNECT_RETRY_BASE_MS : Math.min(pendingDelay * 2, RECONNECT_RETRY_MAX_MS);
      }
    }

    it('does not flag a stall while the wait is still explainable as an ordinary cold start', async () => {
      apiMe.mockRejectedValue(new TypeError('Failed to fetch'));
      loadAuthSnapshot.mockReturnValue(null);
      renderHarness();

      await runAttempts(BOOT_STALL_AFTER_ATTEMPTS - 1);
      expect(screen.getByTestId('stalled').textContent).toBe('false');
      expect(screen.getByTestId('status').textContent).toBe('loading');
    });

    it('flags the stall once the failures stop being explainable, and keeps retrying anyway', async () => {
      apiMe.mockRejectedValue(new TypeError('Failed to fetch'));
      loadAuthSnapshot.mockReturnValue(null);
      renderHarness();

      await runAttempts(BOOT_STALL_AFTER_ATTEMPTS);
      expect(screen.getByTestId('stalled').textContent).toBe('true');
      // Bounded VISIBILITY, not a bounded retry -- the session is not discarded and the token is
      // untouched, so a backend that comes back still heals this with no interaction.
      expect(setAuthToken).not.toHaveBeenCalled();
      expect(clearAuthSnapshot).not.toHaveBeenCalled();
      const attemptsAtStall = apiMe.mock.calls.length;
      await runAttempts(2);
      expect(apiMe.mock.calls.length).toBeGreaterThan(attemptsAtStall);
    });

    it('clears the stall by itself when a later attempt finally succeeds', async () => {
      apiMe.mockRejectedValue(new TypeError('Failed to fetch'));
      loadAuthSnapshot.mockReturnValue(null);
      renderHarness();

      await runAttempts(BOOT_STALL_AFTER_ATTEMPTS);
      expect(screen.getByTestId('stalled').textContent).toBe('true');

      apiMe.mockResolvedValue(SNAPSHOT);
      await runAttempts(2);
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
      expect(screen.getByTestId('stalled').textContent).toBe('false');
    });
  });

  // The root cause behind all of the above. login() used to run every teardown -- resetQueryCache,
  // clearAuthSnapshot -- and persist the new token BEFORE /me had confirmed anything. Against a
  // scale-to-zero backend (~35s cold start vs api/client.js's abort) that /me routinely failed,
  // leaving a VALID token, no snapshot and no cached data: precisely the input the boot effect
  // reads as "retry forever".
  describe('a sign-in whose /me never lands must leave the device exactly as it found it', () => {
    beforeEach(() => {
      getAuthToken.mockReturnValue(null);
      loadAuthSnapshot.mockReturnValue(null);
      apiMe.mockRejectedValue(new TypeError('Failed to fetch'));
      apiLogin.mockResolvedValue({ token: 'fresh-token' });
    });

    it('puts the token back rather than stranding one with no identity behind it', async () => {
      renderHarness();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
      setAuthToken.mockClear();

      fireEvent.click(screen.getByText('login'));

      await waitFor(() => expect(setAuthToken).toHaveBeenCalledWith('fresh-token'));
      // ...and then undone, because /me never confirmed it. The LAST word must be the token this
      // device had before the attempt (here: none), or the next boot inherits the stranded state.
      await waitFor(() => expect(setAuthToken).toHaveBeenLastCalledWith(null));
    });

    it('keeps the previous session usable: neither the snapshot nor the persisted cache is discarded', async () => {
      getAuthToken.mockReturnValue('existing-token');
      loadAuthSnapshot.mockReturnValue(SNAPSHOT);
      renderHarness();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
      clearAuthSnapshot.mockClear();
      resetQueryCache.mockClear();
      setAuthToken.mockClear();

      fireEvent.click(screen.getByText('login'));
      await waitFor(() => expect(apiLogin).toHaveBeenCalled());
      await waitFor(() => expect(setAuthToken).toHaveBeenLastCalledWith('existing-token'));

      // Nothing the device was still relying on may be torn down by an attempt that failed.
      expect(clearAuthSnapshot).not.toHaveBeenCalled();
      expect(resetQueryCache).not.toHaveBeenCalled();
    });

    it('still discards the previous household\'s cached state once /me DOES land', async () => {
      apiMe.mockReset();
      apiMe.mockResolvedValue(SNAPSHOT);
      renderHarness();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
      resetQueryCache.mockClear();

      fireEvent.click(screen.getByText('login'));

      // Account-shared keys (catalog, tags) carry no accountId, so this clear is what stops a
      // second household reading the first's -- moving it after /me must not lose it.
      await waitFor(() => expect(resetQueryCache).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    });

    it('does NOT put back a token the server has definitively rejected', async () => {
      getAuthToken.mockReturnValue('existing-token');
      loadAuthSnapshot.mockReturnValue(SNAPSHOT);
      apiMe.mockReset();
      // First call is the boot one; the login's /me is the 401.
      apiMe.mockResolvedValueOnce(SNAPSHOT);
      apiMe.mockRejectedValueOnce({ status: 401 });
      renderHarness();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
      setAuthToken.mockClear();

      fireEvent.click(screen.getByText('login'));

      await waitFor(() => expect(setAuthToken).toHaveBeenCalledWith('fresh-token'));
      // A 4xx is the server's real answer: api/client.js has already cleared the token and run the
      // unauthorized handler, so restoring the old one would resurrect a rejected session.
      await new Promise((r) => setTimeout(r, 0));
      expect(setAuthToken).not.toHaveBeenCalledWith('existing-token');
    });
  });
});
