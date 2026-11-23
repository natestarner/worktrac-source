import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from './ForgotPasswordPage';
import { useAuth } from '../context/AuthContext';
import { availableSignInProviders } from '../lib/native';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/native', () => ({ availableSignInProviders: vi.fn(() => []) }));

const LAST_USED_KEY = 'huddle-last-sign-in-method';
const ALL_USED_KEY = 'huddle-sign-in-methods';

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

  // Someone who joined with Apple's "Hide My Email" has an account under a relay address they have
  // never seen, so the email they type here matches nothing. Only the device can point them back.
  describe('pointing back at Apple or Google', () => {
    beforeEach(() => {
      localStorage.removeItem(LAST_USED_KEY);
      localStorage.removeItem(ALL_USED_KEY);
      availableSignInProviders.mockReturnValue(['apple', 'google']);
    });

    it('names the provider a device without a password has signed in with, and links to Log in', () => {
      localStorage.setItem(ALL_USED_KEY, JSON.stringify(['apple']));
      renderPage();
      const hint = screen.getByTestId('forgot-password-provider-hint');
      expect(hint).toHaveTextContent(
        'Signed up with Apple? This device has signed in with Apple before. An account made that way has no password to reset.',
      );
      expect(screen.getByRole('link', { name: 'Log in with Apple' })).toHaveAttribute('href', '/login');
      // The form is still there: it is a hint, not a gate.
      expect(screen.getByRole('button', { name: 'Send reset code' })).toBeEnabled();
    });

    it('names both when the device has used both', () => {
      localStorage.setItem(ALL_USED_KEY, JSON.stringify(['google', 'apple']));
      renderPage();
      expect(screen.getByTestId('forgot-password-provider-hint')).toHaveTextContent('Signed up with Google or Apple?');
    });

    it('says nothing on a device that has also used a password, or never signed in', () => {
      localStorage.setItem(ALL_USED_KEY, JSON.stringify(['apple', 'password']));
      const { unmount } = renderPage();
      expect(screen.queryByTestId('forgot-password-provider-hint')).not.toBeInTheDocument();
      unmount();

      localStorage.removeItem(ALL_USED_KEY);
      renderPage();
      expect(screen.queryByTestId('forgot-password-provider-hint')).not.toBeInTheDocument();
    });

    it('never names a provider this build does not offer', () => {
      localStorage.setItem(ALL_USED_KEY, JSON.stringify(['apple']));
      availableSignInProviders.mockReturnValue(['google']);
      renderPage();
      expect(screen.queryByTestId('forgot-password-provider-hint')).not.toBeInTheDocument();
    });
  });
});
