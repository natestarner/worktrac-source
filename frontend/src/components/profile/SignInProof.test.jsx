import { onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeleteAccountModal from './DeleteAccountModal';
import ChangePasswordSection from './ChangePasswordSection';
import { deleteAccount } from '../../api/account';
import { useAuth } from '../../context/AuthContext';
import { useSignInMethods } from '../../hooks/useSignInMethods';
import { availableSignInProviders, signInWithProvider } from '../../lib/native';

// Proving it's you without a password: deleting the account, and setting a first password, on a
// login that signs in with Apple or Google.
vi.mock('../../api/account', () => ({ deleteAccount: vi.fn() }));
vi.mock('../../api/export', () => ({ downloadAllPeopleZip: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: () => ({ showToast: vi.fn() }) }));
vi.mock('../../hooks/useSignInMethods', () => ({ useSignInMethods: vi.fn() }));
vi.mock('../../lib/native', async (importOriginal) => ({
  ...(await importOriginal()),
  availableSignInProviders: vi.fn(),
  googleUsesRenderedButton: () => false,
  renderGoogleButton: vi.fn(),
  signInWithProvider: vi.fn(),
}));
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

function methods(hasPassword, connected) {
  return { data: { hasPassword, connected: connected.map((provider) => ({ provider })), available: connected } };
}

describe('proving it is you with Apple or Google', () => {
  let logout;
  let setFirstPassword;

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    logout = vi.fn();
    setFirstPassword = vi.fn().mockResolvedValue(undefined);
    useAuth.mockReturnValue({ people: [{ id: 1, name: 'Sam' }], logout, setFirstPassword, changeOwnPassword: vi.fn() });
    availableSignInProviders.mockReturnValue(['apple', 'google']);
    signInWithProvider.mockResolvedValue({
      idToken: 'id', nonce: 'raw', appleAuthorizationCode: 'code', appleRedirectUri: 'https://r',
    });
  });

  describe('deleting the account', () => {
    it('a login with no password confirms with its provider instead of typing one', async () => {
      useSignInMethods.mockReturnValue(methods(false, ['google']));
      deleteAccount.mockResolvedValue(null);
      render(<DeleteAccountModal onClose={vi.fn()} />);

      expect(screen.queryByPlaceholderText('Your password')).not.toBeInTheDocument();
      const confirm = screen.getByRole('button', { name: 'Delete and confirm with Google' });
      expect(confirm).toBeDisabled();

      fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
      fireEvent.click(confirm);

      await waitFor(() => expect(logout).toHaveBeenCalled());
      expect(deleteAccount).toHaveBeenCalledWith('DELETE', undefined, expect.objectContaining({
        provider: 'google', idToken: 'id', nonce: 'raw',
      }));
    });

    // Apple asks apps to disconnect from the Apple ID on deletion, and only Apple's sheet hands
    // over the code that takes -- so Apple is asked even of a login that has a password.
    it('a login with Apple connected confirms with Apple, sending its code', async () => {
      useSignInMethods.mockReturnValue(methods(true, ['apple', 'google']));
      deleteAccount.mockResolvedValue(null);
      render(<DeleteAccountModal onClose={vi.fn()} />);

      expect(screen.queryByRole('button', { name: /confirm with Google/ })).not.toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
      fireEvent.click(screen.getByRole('button', { name: 'Delete and confirm with Apple' }));

      await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('DELETE', undefined, expect.objectContaining({
        provider: 'apple', appleAuthorizationCode: 'code', appleRedirectUri: 'https://r',
      })));
    });

    // Not loaded (first open, offline) reads as a password login; the server's own answer corrects
    // it rather than leaving somebody stuck at a password field they have no password for.
    it("switches to the provider when the server says this login has no password", async () => {
      useSignInMethods.mockReturnValue({ data: undefined });
      deleteAccount.mockRejectedValue(Object.assign(new Error('Confirm with Apple or Google to delete your account.'), {
        status: 403, code: 'NO_PASSWORD',
      }));
      const { rerender } = render(<DeleteAccountModal onClose={vi.fn()} />);
      fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
      fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'guess-guess' } });
      fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

      expect(await screen.findByText('Confirm with Apple or Google to delete your account.')).toBeInTheDocument();
      // Once the methods load, the provider's button is what is offered.
      useSignInMethods.mockReturnValue(methods(false, ['google']));
      rerender(<DeleteAccountModal onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Delete and confirm with Google' })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Your password')).not.toBeInTheDocument();
    });

    it('a password login still deletes with its password, exactly as before', async () => {
      useSignInMethods.mockReturnValue(methods(true, ['google']));
      deleteAccount.mockResolvedValue(null);
      render(<DeleteAccountModal onClose={vi.fn()} />);

      fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
      fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'pw-12345' } });
      fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

      await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('DELETE', 'pw-12345'));
    });
  });

  describe('setting a first password', () => {
    it('offers "Set a password" instead of "Change", and confirms with a connected provider', async () => {
      useSignInMethods.mockReturnValue(methods(false, ['apple']));
      render(<ChangePasswordSection />);

      expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Set a password' }));

      const confirm = screen.getByRole('button', { name: 'Confirm with Apple' });
      expect(confirm).toBeDisabled();
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'first-password' } });
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'first-password' } });
      fireEvent.click(confirm);

      await waitFor(() => expect(setFirstPassword).toHaveBeenCalledWith({
        newPassword: 'first-password',
        reconfirmation: { provider: 'apple', idToken: 'id', nonce: 'raw' },
      }));
    });

    it('a login with a password sees Change, as always', () => {
      useSignInMethods.mockReturnValue(methods(true, ['google']));
      render(<ChangePasswordSection />);
      expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Set a password' })).not.toBeInTheDocument();
    });
  });
});
