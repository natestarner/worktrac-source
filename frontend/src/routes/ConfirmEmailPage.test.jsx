import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmEmailPage from './ConfirmEmailPage';
import { useAuth } from '../context/AuthContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

function renderWithEmail(email = 'alex@example.com') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/confirm-email', state: email ? { email } : undefined }]}>
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

  beforeEach(() => {
    vi.clearAllMocks();
    confirmEmail = vi.fn().mockResolvedValue();
    resendCode = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ confirmEmail, resendCode });
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
  });
});
