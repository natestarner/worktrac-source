import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPasswordPage from './ResetPasswordPage';
import { useAuth } from '../context/AuthContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

function renderWithEmail(email = 'alex@example.com') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/reset-password', state: email ? { email } : undefined }]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/forgot-password" element={<div>Forgot password page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ResetPasswordPage', () => {
  let resetPassword;
  let resendResetCode;

  beforeEach(() => {
    vi.clearAllMocks();
    resetPassword = vi.fn().mockResolvedValue();
    resendResetCode = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ resetPassword, resendResetCode });
  });

  it('redirects to /forgot-password when no email is in location state (e.g. after a page reload)', () => {
    renderWithEmail(null);
    expect(screen.getByText('Forgot password page')).toBeInTheDocument();
  });

  it('shows inline errors and does not call the API for a short code or short password', async () => {
    renderWithEmail();

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Enter the 6-digit code.')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('resets with a valid code and password, then navigates to /login with a success message', async () => {
    renderWithEmail('alex@example.com');

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'newpassword456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({ email: 'alex@example.com', code: '123456', password: 'newpassword456' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: { message: "Password reset -- sign in with your new password." },
    });
  });

  it('shows the server error message (e.g. expired/locked/wrong code) without navigating', async () => {
    resetPassword.mockRejectedValue(new Error('This code has expired -- request a new one'));
    renderWithEmail();

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'newpassword456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('This code has expired -- request a new one')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('resend calls the API and disables the button during cooldown', async () => {
    renderWithEmail('alex@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));

    await waitFor(() => expect(resendResetCode).toHaveBeenCalledWith({ email: 'alex@example.com' }));
    expect(await screen.findByRole('button', { name: 'Resend code (60s)' })).toBeDisabled();
    expect(screen.getByText('New code sent.')).toBeInTheDocument();
  });
});
