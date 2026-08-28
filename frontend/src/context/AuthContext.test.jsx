import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { confirmEmail as apiConfirmEmail, login as apiLogin, me as apiMe, register as apiRegister } from '../api/auth';
import { getAuthToken, setAuthToken } from '../api/client';
import { clearOutboxMutations, flushOutbox } from '../lib/queryClient';
import { __resetOutboxAccountForTests, setOutboxAccountId } from '../lib/outboxPersistence';
import { isOnboardingPending } from '../lib/onboardingPending';

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  me: vi.fn(),
  register: vi.fn(),
  confirmEmail: vi.fn(),
  resendCode: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getAuthToken: vi.fn(() => null),
  setAuthToken: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));
// Real queryClient singleton + resetQueryCache (safe under jsdom, no indexedDB needed for a query
// cache clear); only clearOutboxMutations/flushOutbox are spied on, to verify login()/confirmEmail()
// call them correctly without needing a real mutation cache round-trip (that's covered at the
// queryClient.js/outboxPersistence.js layer already).
vi.mock('../lib/queryClient', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, clearOutboxMutations: vi.fn(), flushOutbox: vi.fn() };
});

// register() only starts the pending registration (no account exists yet); confirmEmail() is
// what actually logs the user in, once the code checks out and the account gets created.
function Harness() {
  const { status, register, confirmEmail, login } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <button onClick={() => register({ email: 'alex@example.com', password: 'password123', personName: 'Alex' })}>
        register
      </button>
      <button onClick={() => confirmEmail({ email: 'alex@example.com', code: '123456' })}>confirm</button>
      <button onClick={() => login('alex@example.com', 'password123')}>login</button>
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

describe('AuthContext register/confirmEmail split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthToken.mockReturnValue(null);
    __resetOutboxAccountForTests();
    localStorage.clear();
  });

  afterEach(() => {
    __resetOutboxAccountForTests();
    localStorage.clear();
  });

  it('register starts the pending registration but does not store a token or authenticate', async () => {
    apiRegister.mockResolvedValue({ email: 'alex@example.com' });
    renderHarness();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    fireEvent.click(screen.getByText('register'));

    await waitFor(() =>
      expect(apiRegister).toHaveBeenCalledWith({
        email: 'alex@example.com',
        password: 'password123',
        personName: 'Alex',
      }),
    );
    expect(setAuthToken).not.toHaveBeenCalled();
    expect(apiMe).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated');
  });

  it('confirmEmail stores the token and authenticates the user', async () => {
    apiConfirmEmail.mockResolvedValue({ token: 'tok-123' });
    apiMe.mockResolvedValue({ user: { email: 'alex@example.com' }, account: { id: 1 }, people: [{ id: 1 }] });
    renderHarness();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    fireEvent.click(screen.getByText('confirm'));

    await waitFor(() =>
      expect(apiConfirmEmail).toHaveBeenCalledWith({ email: 'alex@example.com', code: '123456' }),
    );
    expect(setAuthToken).toHaveBeenCalledWith('tok-123');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
  });

  // The welcome modal's whole trigger. confirmEmail is the only path where the account is
  // provably created in this same request -- see the comment on the call site.
  it('confirmEmail arms the welcome modal for the newly-created account', async () => {
    apiConfirmEmail.mockResolvedValue({ token: 'tok-123' });
    apiMe.mockResolvedValue({ user: { email: 'alex@example.com' }, account: { id: 1 }, people: [{ id: 1 }] });
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    fireEvent.click(screen.getByText('confirm'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(isOnboardingPending(1)).toBe(true);
  });
});

describe('AuthContext login outbox account adoption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthToken.mockReturnValue(null);
    __resetOutboxAccountForTests();
    localStorage.clear();
    apiLogin.mockResolvedValue({ token: 'tok-456' });
    apiMe.mockResolvedValue({ user: { email: 'alex@example.com' }, account: { id: 5 }, people: [{ id: 1 }] });
  });

  afterEach(() => {
    __resetOutboxAccountForTests();
    localStorage.clear();
  });

  // login() runs on every ordinary sign-in an account will ever do, including years later, so
  // unlike confirmEmail it can never be the moment "this account was just created".
  it('an ordinary login does not arm the welcome modal', async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(isOnboardingPending(5)).toBe(false);
  });

  it('the SAME account logging back in (e.g. after a 401) does not evict the live outbox', async () => {
    setOutboxAccountId(5); // this account already owns whatever's in the live mutation cache
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(clearOutboxMutations).not.toHaveBeenCalled();
    expect(flushOutbox).toHaveBeenCalled();
  });

  it('a DIFFERENT account logging in evicts whatever the prior account left in the live outbox', async () => {
    setOutboxAccountId(999); // a different household's queued writes are still sitting in memory
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(clearOutboxMutations).toHaveBeenCalled();
  });

  it('a first-ever login (no prior pointer) does not evict anything', async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(clearOutboxMutations).not.toHaveBeenCalled();
  });
});
