import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';
import { useAuth } from '../context/AuthContext';
import { SIGNING_IN_ESCAPE_MS, SIGNING_IN_MIN_MS, SIGNING_IN_SLOW_MS } from '../components/auth/useSigningIn';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => mockNavigate,
}));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
// No Apple / Google here: these tests are about the password form's own overlay.
vi.mock('../lib/native', async (importOriginal) => ({
  ...(await importOriginal()),
  availableSignInProviders: () => [],
}));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// A password sign-in gets the same full-screen "Signing you in…" overlay Apple / Google do, with
// the same minimum time on screen and the same three exits (SigningInOverlay.jsx).
describe('LoginPage: the "Signing you in" overlay', () => {
  let login;
  let chooseAccount;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    login = vi.fn();
    chooseAccount = vi.fn();
    useAuth.mockReturnValue({ login, chooseAccount, signInWithIdToken: vi.fn() });
    localStorage.removeItem('huddle-last-sign-in-method');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function submit(email = 'sam@example.com', password = 'correct horse') {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: email } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await act(async () => {});
  }

  it('covers the screen while the sign-in is in flight, portalled to <body>', async () => {
    login.mockReturnValue(new Promise(() => {}));
    await submit();

    const overlay = screen.getByTestId('signing-in-overlay');
    expect(overlay).toHaveTextContent('Signing you in…');
    expect(overlay.parentElement).toBe(document.body);
    expect(login).toHaveBeenCalledWith('sam@example.com', 'correct horse');
  });

  it('stays up for its minimum time even when the answer is instant, then goes into the app', async () => {
    login.mockResolvedValue(null);
    await submit();

    act(() => vi.advanceTimersByTime(SIGNING_IN_MIN_MS - 1));
    await act(async () => {});
    expect(screen.getByTestId('signing-in-overlay')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(mockNavigate).toHaveBeenCalledWith('/app/log');
    expect(localStorage.getItem('huddle-last-sign-in-method')).toBe('password');
  });

  it('a wrong password takes it down after the minimum and shows the reason on the form', async () => {
    login.mockRejectedValue(new Error('Invalid email or password'));
    await submit();
    expect(screen.getByTestId('signing-in-overlay')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(SIGNING_IN_MIN_MS); });
    expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('comes down before the household picker, which keeps its own button spinner', async () => {
    login.mockResolvedValue({
      accounts: [{ accountId: 1, accountName: 'Home' }, { accountId: 2, accountName: 'Gym' }],
      selectionToken: 'sel',
    });
    await submit();
    await act(async () => { vi.advanceTimersByTime(SIGNING_IN_MIN_MS); });

    expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('says it is still working only after a while', async () => {
    login.mockReturnValue(new Promise(() => {}));
    await submit();

    act(() => vi.advanceTimersByTime(SIGNING_IN_SLOW_MS - 1));
    expect(screen.getByTestId('signing-in-overlay')).not.toHaveTextContent('Still working');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('signing-in-overlay')).toHaveTextContent('Still working');
  });

  // ⚠️ The worst case: an attempt that NEVER finishes. The overlay must still have a way out.
  describe('an attempt that never finishes', () => {
    async function startStuckAttempt() {
      const request = deferred();
      login.mockReturnValueOnce(request.promise);
      await submit();
      return request;
    }

    function startOver() {
      act(() => vi.advanceTimersByTime(SIGNING_IN_ESCAPE_MS));
      fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    }

    it('offers "Start over" only once nothing legitimate could still be running', async () => {
      await startStuckAttempt();
      act(() => vi.advanceTimersByTime(SIGNING_IN_ESCAPE_MS - 1));
      expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument();
    });

    it('"Start over" takes the overlay down and gives back a working form', async () => {
      await startStuckAttempt();
      startOver();

      expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('taking longer than it should');
      expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    });

    it('a new attempt works normally, and the old one finishing late cannot touch it', async () => {
      const stale = await startStuckAttempt();
      startOver();

      const fresh = deferred();
      login.mockReturnValueOnce(fresh.promise);
      fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
      await act(async () => {});
      expect(screen.getByTestId('signing-in-overlay')).toBeInTheDocument();

      await act(async () => stale.reject(new Error('Old failure')));
      await act(async () => { vi.advanceTimersByTime(SIGNING_IN_MIN_MS); });
      expect(screen.getByTestId('signing-in-overlay')).toBeInTheDocument();
      expect(screen.queryByText('Old failure')).not.toBeInTheDocument();

      await act(async () => fresh.reject(new Error('New failure')));
      await act(async () => { vi.advanceTimersByTime(SIGNING_IN_MIN_MS); });
      expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('New failure');
    });

    it('an abandoned attempt that signs in after all still takes the person into the app', async () => {
      const stale = await startStuckAttempt();
      startOver();

      await act(async () => stale.resolve(null));
      expect(mockNavigate).toHaveBeenCalledWith('/app/log');
    });

    it('an abandoned attempt that lands on the household picker is dropped', async () => {
      const stale = await startStuckAttempt();
      startOver();

      await act(async () => stale.resolve({ accounts: [{ accountId: 1, accountName: 'Home' }], selectionToken: 'sel' }));
      expect(screen.queryByText('Home')).not.toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    });
  });
});
