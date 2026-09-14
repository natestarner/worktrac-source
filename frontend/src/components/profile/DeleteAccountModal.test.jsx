import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeleteAccountModal from './DeleteAccountModal';
import { deleteAccount } from '../../api/account';
import { downloadAllPeopleZip } from '../../api/export';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../api/account', () => ({ deleteAccount: vi.fn() }));
vi.mock('../../api/export', () => ({ downloadAllPeopleZip: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

describe('DeleteAccountModal', () => {
  let logout;

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    logout = vi.fn();
    useAuth.mockReturnValue({
      people: [{ id: 1, name: 'Alex' }, { id: 2, name: 'Sam' }],
      logout,
    });
  });
  afterEach(() => onlineManager.setOnline(true));

  // BOTH fields are required. Typing DELETE proves intent; the password proves identity. The
  // bearer token that got them this far is valid for 30 days and cannot be revoked, so it is a weak
  // thing to hang an irreversible, unrecoverable action on by itself.
  it('keeps the delete button disabled until DELETE is typed exactly and a password is given', () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete account' });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'delete' } });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'password123' } });
    expect(deleteButton).not.toBeDisabled();
  });

  it('keeps the delete button disabled when only the password is given', () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'password123' } });
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  });

  it('deletes the account, logs out, and navigates to /login on success', async () => {
    deleteAccount.mockResolvedValue();
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('DELETE', 'password123'));
    expect(logout).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/login');
  });

  it('shows an inline error and does not log out or navigate when the request fails', async () => {
    deleteAccount.mockRejectedValue(new Error('Something went wrong'));
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('lets everyone’s data be downloaded as a zip before deleting', () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download all' }));
    expect(downloadAllPeopleZip).toHaveBeenCalled();
  });

  it('disables "Download all" while offline', () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole('button', { name: 'Download all' })).toBeDisabled();
  });
});

// ⚠️ On a family account, deleting destroys YOUR OWN data. On a trainer's it destroys OTHER
// PEOPLE'S -- clients who never agreed to it and cannot get it back. Naming the number is what
// turns "everyone on this account" from a phrase into a fact somebody has to read past.
describe('DeleteAccountModal — who else this takes with it', () => {
  const PRO_VOCAB = { account: 'practice', owner: 'trainer', member: 'client', manager: 'assistant' };

  function renderWith(people, vocab = PRO_VOCAB) {
    useAuth.mockReturnValue({
      account: { vocab },
      people,
      logout: vi.fn(),
    });
    return render(<DeleteAccountModal onClose={vi.fn()} />);
  }

  it('names how many other people lose their data, in the account’s own words', () => {
    renderWith([{ id: 1, name: 'Nate' }, { id: 2, name: 'Dana' }, { id: 3, name: 'Sam' }]);

    expect(screen.getByText(/2 other clients, and they cannot get it back/)).toBeInTheDocument();
  });

  it('says one client rather than 1 other clients', () => {
    renderWith([{ id: 1, name: 'Nate' }, { id: 2, name: 'Dana' }]);

    expect(screen.getByText(/1 other client, and they cannot get it back/)).toBeInTheDocument();
  });

  // A family account says "family members", from the same vocabulary the rest of the app uses.
  it('uses the family noun on a family account', () => {
    renderWith([{ id: 1, name: 'Nate' }, { id: 2, name: 'Sam' }], null);

    expect(screen.getByText(/1 other family member, and they cannot get it back/)).toBeInTheDocument();
  });

  // Deleting an account that is only you is not the case this warning is for, and adding it there
  // would make the sentence noise on the overwhelmingly common path.
  it('says nothing extra when nobody else is on the account', () => {
    renderWith([{ id: 1, name: 'Nate' }]);

    expect(screen.queryByText(/cannot get it back/)).toBeNull();
  });
});
