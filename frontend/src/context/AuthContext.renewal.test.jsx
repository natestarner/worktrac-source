import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth, IDENTITY_STALE_AFTER_MS } from './AuthContext';
import { me as apiMe } from '../api/auth';
import { setAuthToken } from '../api/client';
import { saveAuthSnapshot } from '../lib/authSnapshot';
import { __resetOutboxScopeForTests } from '../lib/outboxPersistence';

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
// A real little token store, so "the current token" changes when the app adopts a renewal -- which
// is exactly what the staleness checks compare against.
const store = vi.hoisted(() => ({ token: null }));
vi.mock('../api/client', () => ({
  getAuthToken: vi.fn(() => store.token),
  setAuthToken: vi.fn((t) => {
    store.token = t;
  }),
  setUnauthorizedHandler: vi.fn(),
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

// Sessions used to end exactly 30 days after sign-in, however often the app was opened. /me now
// answers a token over a day old with `renewedToken`, and the app must take it -- after its own
// "is this answer still for my token?" checks, never before (which would make them drop the answer).
const IDENTITY = { user: { id: 3, email: 'nate@example.com' }, account: { id: 7, plan: 'FREE' }, people: [{ id: 1, name: 'Nate' }] };

function Harness() {
  const { status, people } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="people">{people.length}</span>
    </div>
  );
}

function boot() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </MemoryRouter>,
  );
}

let visibility = 'visible';
let now = 1_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  __resetOutboxScopeForTests();
  onlineManager.setOnline(true);
  store.token = 'old-token';
  visibility = 'visible';
  now = 1_000_000;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  __resetOutboxScopeForTests();
});

describe('AuthContext: a renewed session token from /me', () => {
  it('is adopted at boot, and the boot still completes with the answer', async () => {
    apiMe.mockResolvedValue({ ...IDENTITY, renewedToken: 'fresh-token' });
    boot();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('people').textContent).toBe('1');
    expect(store.token).toBe('fresh-token');
  });

  it('is never written into the saved identity snapshot', async () => {
    apiMe.mockResolvedValue({ ...IDENTITY, renewedToken: 'fresh-token' });
    boot();

    await waitFor(() => expect(saveAuthSnapshot).toHaveBeenCalled());
    expect(saveAuthSnapshot).toHaveBeenLastCalledWith(IDENTITY);
  });

  it('is adopted when coming back to the app re-checks the identity', async () => {
    apiMe.mockResolvedValueOnce(IDENTITY).mockResolvedValue({ ...IDENTITY, renewedToken: 'fresh-token' });
    boot();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(store.token).toBe('old-token');

    now += IDENTITY_STALE_AFTER_MS + 1;
    act(() => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(store.token).toBe('fresh-token'));
  });

  it('changes nothing when /me sends none', async () => {
    apiMe.mockResolvedValue(IDENTITY);
    boot();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(store.token).toBe('old-token');
    expect(setAuthToken).not.toHaveBeenCalled();
  });

  // A sign-out (or another sign-in) while /me was on the wire wins: its answer, renewal included,
  // belongs to a session that is gone.
  it('is ignored when the token changed while /me was in flight', async () => {
    let answer;
    apiMe.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    boot();
    await waitFor(() => expect(apiMe).toHaveBeenCalled());

    store.token = 'someone-else';
    await act(async () => answer({ ...IDENTITY, renewedToken: 'fresh-token' }));

    expect(store.token).toBe('someone-else');
  });
});
