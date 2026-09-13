import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChangePasswordSection from './ChangePasswordSection';

const changeOwnPassword = vi.fn();
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ changeOwnPassword }) }));

const showToast = vi.fn();
vi.mock('../../context/UIContext', () => ({ useUI: () => ({ showToast }) }));

// The gate's own offline/error behaviour is tested with the gate; here it is a pass-through so
// these cases are about what the section asks for and what it sends.
vi.mock('../../hooks/useGatedMutation', () => ({
  useGatedMutation: () => ({ online: true, pending: false, run: (fn) => fn }),
}));

vi.mock('../shared/OfflineDisabledWrap', () => ({ default: ({ children }) => children }));
vi.mock('../shared/Modal', () => ({
  default: ({ title, children }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

function openModal() {
  render(<ChangePasswordSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
}

function fill({ current = 'password123', next = 'a-brand-new-one', confirm = next } = {}) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
}

describe('ChangePasswordSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changeOwnPassword.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  /**
   * ⚠️ The current password is the whole point of this screen, and the field being present is what
   * makes the promise on the Profile page true. Without it a borrowed unlocked phone is a permanent
   * account takeover: a live session proves a device, not a person.
   */
  it('asks for the current password, not just a new one', () => {
    openModal();

    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('sends both passwords and confirms it worked', async () => {
    openModal();
    fill();

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(changeOwnPassword).toHaveBeenCalledWith({
        currentPassword: 'password123',
        newPassword: 'a-brand-new-one',
      }),
    );
    expect(showToast).toHaveBeenCalledWith('Password changed.');
  });

  // A typo'd new password is a typing mistake, not an invalid request -- there is nothing for the
  // server to compare against, so this is the one check that belongs here.
  it('refuses to send when the two new passwords differ', async () => {
    openModal();
    fill({ next: 'a-brand-new-one', confirm: 'something-else' });

    expect(screen.getByText("Those don't match.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(changeOwnPassword).not.toHaveBeenCalled();
  });

  it('refuses to send a new password shorter than the server would accept', async () => {
    openModal();
    fill({ next: 'short', confirm: 'short' });

    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(changeOwnPassword).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ Said BEFORE they commit. Being signed out of every other device is the part people are
   * surprised by, and the surprise costs them a re-login on each one. Telling them afterwards is
   * telling them once it is too late to decide.
   */
  it('warns that every other device will be signed out, before the change is made', () => {
    openModal();

    expect(screen.getByText(/other device signed in as you will be signed out/i)).toBeInTheDocument();
    expect(changeOwnPassword).not.toHaveBeenCalled();
  });
});
