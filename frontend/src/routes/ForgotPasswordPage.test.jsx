import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from './ForgotPasswordPage';
import { useAuth } from '../context/AuthContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

describe('ForgotPasswordPage', () => {
  let requestPasswordReset;

  beforeEach(() => {
    vi.clearAllMocks();
    requestPasswordReset = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ requestPasswordReset });
  });

  // This form used to answer an empty submit with a bare `return` -- nothing happened, nothing was
  // said, and it was the only auth form in the app that stayed silent. Whitespace-only is the case
  // `required` could never have caught, which is why the check trims.
  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('shows an inline error and does not submit for a %s email', async (_label, value) => {
    renderPage();

    if (value) fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('clears the field error once the user types', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a' } });

    expect(screen.queryByText('Enter your email address.')).not.toBeInTheDocument();
  });

  it('requests a reset then navigates to /reset-password with the email in state', async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'alex@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith({ email: 'alex@example.com' }));
    expect(mockNavigate).toHaveBeenCalledWith('/reset-password', { state: { email: 'alex@example.com' } });
  });

  // The backend always resolves this call (even for an unregistered email) so the frontend
  // never has to -- and must never -- distinguish "known" from "unknown" here.
  it('navigates to /reset-password the same way regardless of whether the email is registered', async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'nobody@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith({ email: 'nobody@example.com' }));
    expect(mockNavigate).toHaveBeenCalledWith('/reset-password', { state: { email: 'nobody@example.com' } });
  });

  it('shows a server error banner (e.g. rate limited) and does not navigate on failure', async () => {
    requestPasswordReset.mockRejectedValue(new Error('Too many requests from this address -- please try again later'));
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'alex@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect(await screen.findByText('Too many requests from this address -- please try again later')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
