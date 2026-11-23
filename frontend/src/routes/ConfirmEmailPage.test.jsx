import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmEmailPage from './ConfirmEmailPage';
import { SIGNING_IN_ESCAPE_MS, SIGNING_IN_MIN_MS } from '../components/auth/useSigningIn';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/UIContext', () => ({ useUI: vi.fn() }));

function renderWithEmail(email = 'alex@example.com', extraState = {}) {
  return render(
    <MemoryRouter
      initialEntries={[
        { pathname: '/confirm-email', state: email ? { email, ...extraState } : undefined },
      ]}
    >
      <Routes>
        <Route path="/confirm-email" element={<ConfirmEmailPage />} />
        <Route path="/register" element={<div>Register page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConfirmEmailPage', () => {
  let confirmEmail;
  let resendCode;
  let deferOnboarding;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmEmail = vi.fn().mockResolvedValue();
    resendCode = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ confirmEmail, resendCode });
    deferOnboarding = vi.fn();
    useUI.mockReturnValue({ deferOnboarding });
  });

  it('redirects to /register when no email is in location state (e.g. after a page reload)', () => {
    renderWithEmail(null);
    expect(screen.getByText('Register page')).toBeInTheDocument();
  });

  it('shows an inline error and does not call the API for a short code', async () => {
    renderWithEmail();

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Enter the 6-digit code.')).toBeInTheDocument();
    expect(confirmEmail).not.toHaveBeenCalled();
  });

  it('confirms a valid code and navigates to /app/log', async () => {
    renderWithEmail('alex@example.com');

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(confirmEmail).toHaveBeenCalledWith({ email: 'alex@example.com', code: '123456' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/log'));
    // An ordinary registration must NOT defer the welcome modal -- it is the whole first-run
    // experience, and suppressing it here would silently cost every non-Go-Plus household the tour.
    expect(deferOnboarding).not.toHaveBeenCalled();
  });

  // The marketing "Go Plus" path. Two things change and nothing else: where they land, and that the
  // first-run welcome modal waits until the billing decision resolves. A tour interrupting someone
  // who arrived intending to pay is the wrong order.
  it('lands a Go Plus registration on billing, with the welcome modal deferred', async () => {
    renderWithEmail('alex@example.com', { wantsPlan: 'PLUS' });

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/billing?intent=plus'));
    expect(deferOnboarding).toHaveBeenCalled();
  });

  // The trainer half of the same path, from marketing/for-trainers.html's ?plan=pro CTAs. Both
  // paid plans want the identical two things, so this branches on "was a plan named at all" rather
  // than on which one -- the billing screen already carries a card for each. Asserted separately
  // anyway: PRO reaching this page at all is exactly what was broken upstream in RegisterPage, and
  // a test that only ever passes 'PLUS' would not have noticed.
  it('lands a Pro registration on billing too, with the welcome modal deferred', async () => {
    renderWithEmail('sam@example.com', { wantsPlan: 'PRO' });

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/billing?intent=pro'));
    expect(deferOnboarding).toHaveBeenCalled();
  });

  // Deferring AFTER navigating would race the modal it exists to suppress: AppShell reads the gate
  // in an effect that runs as soon as the shell mounts.
  it('defers before navigating, not after', async () => {
    const order = [];
    deferOnboarding.mockImplementation(() => order.push('defer'));
    mockNavigate.mockImplementation(() => order.push('navigate'));
    renderWithEmail('alex@example.com', { wantsPlan: 'PLUS' });

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(order).toEqual(['defer', 'navigate']));
  });

  it('shows the server error message (e.g. expired/locked/wrong code) without navigating', async () => {
    confirmEmail.mockRejectedValue(new Error('This code has expired -- request a new one'));
    renderWithEmail();

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('This code has expired -- request a new one')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('resend calls the API and disables the button during cooldown', async () => {
    renderWithEmail('alex@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));

    await waitFor(() => expect(resendCode).toHaveBeenCalledWith({ email: 'alex@example.com' }));
    expect(await screen.findByRole('button', { name: 'Resend code (60s)' })).toBeDisabled();
    expect(screen.getByText('New code sent.')).toBeInTheDocument();
  });

  it('clears a partially-typed code on resend, since the old code stops working', async () => {
    renderWithEmail('alex@example.com');

    const codeInput = screen.getByPlaceholderText('123456');
    fireEvent.change(codeInput, { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));

    await waitFor(() => expect(resendCode).toHaveBeenCalledWith({ email: 'alex@example.com' }));
    expect(codeInput).toHaveValue('');
  });

  it('disables the resend button and shows a spinner while the request is in flight', async () => {
    let resolveResend;
    resendCode.mockReturnValue(new Promise((resolve) => { resolveResend = resolve; }));
    renderWithEmail('alex@example.com');

    const resendButton = screen.getByRole('button', { name: 'Resend code' });
    fireEvent.click(resendButton);

    await waitFor(() => expect(resendButton).toBeDisabled());
    expect(screen.queryByText('New code sent.')).not.toBeInTheDocument();

    resolveResend();
    expect(await screen.findByRole('button', { name: 'Resend code (60s)' })).toBeDisabled();
  });

  // Confirm creates the account AND signs in, so it gets the same full-screen overlay an Apple /
  // Google sign-up's "Create" does -- with the same minimum time on screen and the same way out.
  describe('the "Creating your household" overlay', () => {
    function deferred() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }

    function submitCode() {
      fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('covers the screen in the same words as an Apple / Google sign-up', async () => {
      confirmEmail.mockReturnValue(new Promise(() => {}));
      renderWithEmail();
      submitCode();

      const overlay = await screen.findByTestId('signing-in-overlay');
      expect(overlay).toHaveTextContent('Creating your household…');
      expect(overlay.parentElement).toBe(document.body);
    });

    it('says "account" for a Pro arrival, as Register and Apple / Google do', async () => {
      confirmEmail.mockReturnValue(new Promise(() => {}));
      renderWithEmail('sam@example.com', { wantsPlan: 'PRO' });
      submitCode();

      expect(await screen.findByTestId('signing-in-overlay')).toHaveTextContent('Creating your account…');
    });

    it('stays up for its minimum time even when the answer is instant, then lands', async () => {
      vi.useFakeTimers();
      renderWithEmail();
      submitCode();
      await act(async () => {});

      act(() => vi.advanceTimersByTime(SIGNING_IN_MIN_MS - 1));
      await act(async () => {});
      expect(screen.getByTestId('signing-in-overlay')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();

      await act(async () => { vi.advanceTimersByTime(1); });
      expect(mockNavigate).toHaveBeenCalledWith('/app/log');
    });

    it('a wrong code takes it down and shows the reason on the code screen', async () => {
      vi.useFakeTimers();
      confirmEmail.mockRejectedValue(new Error('That code is not right'));
      renderWithEmail();
      submitCode();
      await act(async () => {});
      expect(screen.getByTestId('signing-in-overlay')).toBeInTheDocument();

      await act(async () => { vi.advanceTimersByTime(SIGNING_IN_MIN_MS); });
      expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('That code is not right');
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('"Start over" gives back a working screen, and a late success still goes into the app', async () => {
      vi.useFakeTimers();
      const request = deferred();
      confirmEmail.mockReturnValueOnce(request.promise);
      renderWithEmail();
      submitCode();
      await act(async () => {});

      act(() => vi.advanceTimersByTime(SIGNING_IN_ESCAPE_MS));
      fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
      expect(screen.queryByTestId('signing-in-overlay')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('taking longer than it should');
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();

      // The account was created and the session is live: the app is the only honest place to go.
      await act(async () => request.resolve());
      expect(mockNavigate).toHaveBeenCalledWith('/app/log');
    });

    it('a late failure after "Start over" changes nothing on screen', async () => {
      vi.useFakeTimers();
      const request = deferred();
      confirmEmail.mockReturnValueOnce(request.promise);
      renderWithEmail();
      submitCode();
      await act(async () => {});

      act(() => vi.advanceTimersByTime(SIGNING_IN_ESCAPE_MS));
      fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
      await act(async () => request.reject(new Error('Old failure')));
      await act(async () => { vi.advanceTimersByTime(SIGNING_IN_MIN_MS); });

      expect(screen.queryByText('Old failure')).not.toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
