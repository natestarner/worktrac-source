import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth, IDENTITY_STALE_AFTER_MS } from './AuthContext';
import { me as apiMe } from '../api/auth';
import { getAuthToken } from '../api/client';
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
vi.mock('../api/client', () => ({
  getAuthToken: vi.fn(() => null),
  setAuthToken: vi.fn(),
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

// The App Store app resumes a suspended process without reloading it, so /me -- plan, people,
// membership, the minimum supported build -- was only ever asked at boot and on reconnect. These pin
// the third moment: coming back to the app once the identity is IDENTITY_STALE_AFTER_MS old.
const AT_BOOT = { user: { id: 3, email: 'nate@example.com' }, account: { id: 7, plan: 'FREE' }, people: [{ id: 1, name: 'Nate' }] };
const LATER = {
  user: { id: 3, email: 'nate@example.com' },
  account: { id: 7, plan: 'PLUS' },
  people: [{ id: 1, name: 'Nate' }, { id: 2, name: 'Sam' }],
};

function Harness() {
  const { status, people, account } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="people">{people.length}</span>
      <span data-testid="plan">{account?.plan ?? ''}</span>
    </div>
  );
}

let visibility = 'visible';
function comeBack() {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
}

let now;
async function bootedAt(start) {
  now = start;
  render(
    <MemoryRouter>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
  expect(apiMe).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetOutboxScopeForTests();
  onlineManager.setOnline(true);
  getAuthToken.mockReturnValue('valid-token');
  apiMe.mockResolvedValueOnce(AT_BOOT).mockResolvedValue(LATER);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  __resetOutboxScopeForTests();
});

describe('AuthContext: the identity is re-checked when the app comes back', () => {
  it('after a long enough absence, picks up what changed elsewhere', async () => {
    await bootedAt(1_000_000);

    now += IDENTITY_STALE_AFTER_MS + 1;
    act(() => comeBack());

    await waitFor(() => expect(screen.getByTestId('people').textContent).toBe('2'));
    expect(screen.getByTestId('plan').textContent).toBe('PLUS');
    expect(apiMe).toHaveBeenCalledTimes(2);
    expect(saveAuthSnapshot).toHaveBeenLastCalledWith(LATER);
  });

  // Glancing at another app mid-set must not cost /me, the hottest endpoint the server has.
  it('asks nothing when the identity was confirmed recently', async () => {
    await bootedAt(1_000_000);

    now += IDENTITY_STALE_AFTER_MS - 1;
    act(() => comeBack());
    await Promise.resolve();

    expect(apiMe).toHaveBeenCalledTimes(1);
  });

  // Offline it can only fail; coming back online asks anyway.
  it('asks nothing while offline, and asks once the connection returns', async () => {
    await bootedAt(1_000_000);
    act(() => onlineManager.setOnline(false));

    now += IDENTITY_STALE_AFTER_MS + 1;
    act(() => comeBack());
    await Promise.resolve();
    expect(apiMe).toHaveBeenCalledTimes(1);

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(screen.getByTestId('people').textContent).toBe('2'));
  });

  // A failed check is never a sign-out: the cached identity stands until the next moment.
  it('keeps the identity it has when the server does not answer', async () => {
    await bootedAt(1_000_000);
    apiMe.mockReset();
    apiMe.mockRejectedValue({ status: 503 });

    now += IDENTITY_STALE_AFTER_MS + 1;
    act(() => comeBack());

    await waitFor(() => expect(apiMe).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
    expect(screen.getByTestId('people').textContent).toBe('1');
  });

  it('asks once for a burst of returns while a check is already on the wire', async () => {
    await bootedAt(1_000_000);
    let answer;
    apiMe.mockReset();
    apiMe.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    now += IDENTITY_STALE_AFTER_MS + 1;
    act(() => {
      comeBack();
      comeBack();
    });
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));
    expect(apiMe).toHaveBeenCalledTimes(1);

    await act(async () => answer(LATER));
    expect(screen.getByTestId('people').textContent).toBe('2');
  });
});
