import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmEmailPage from './ConfirmEmailPage';
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
    expect(mockNavigate).toHaveBeenCalledWith('/app/log');
    // An ordinary registration must NOT defer the welcome modal -- it is the whole first-run
    // experience, and suppressing it here would silently cost every non-Go-Pro household the tour.
    expect(deferOnboarding).not.toHaveBeenCalled();
  });

  // The marketing "Go Pro" path. Two things change and nothing else: where they land, and that the
  // first-run welcome modal waits until the billing decision resolves. A tour interrupting someone
  // who arrived intending to pay is the wrong order.
  it('lands a Go Pro registration on billing, with the welcome modal deferred', async () => {
    renderWithEmail('alex@example.com', { wantsPro: true });

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/billing'));
    expect(deferOnboarding).toHaveBeenCalled();
  });

  // Deferring AFTER navigating would race the modal it exists to suppress: AppShell reads the gate
  // in an effect that runs as soon as the shell mounts.
  it('defers before navigating, not after', async () => {
    const order = [];
    deferOnboarding.mockImplementation(() => order.push('defer'));
    mockNavigate.mockImplementation(() => order.push('navigate'));
    renderWithEmail('alex@example.com', { wantsPro: true });

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
});
