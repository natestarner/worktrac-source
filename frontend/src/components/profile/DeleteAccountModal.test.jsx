import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeleteAccountModal from './DeleteAccountModal';
import { deleteAccount } from '../../api/account';
import { downloadPersonCsv } from '../../api/export';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../api/account', () => ({ deleteAccount: vi.fn() }));
vi.mock('../../api/export', () => ({ downloadPersonCsv: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

describe('DeleteAccountModal', () => {
  let logout;

  beforeEach(() => {
    vi.clearAllMocks();
    logout = vi.fn();
    useAuth.mockReturnValue({
      people: [{ id: 1, name: 'Alex' }, { id: 2, name: 'Sam' }],
      logout,
    });
  });

  it('keeps the delete button disabled until DELETE is typed exactly', () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete account' });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'delete' } });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
    expect(deleteButton).not.toBeDisabled();
  });

  it('deletes the account, logs out, and navigates to /login on success', async () => {
    deleteAccount.mockResolvedValue();
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('DELETE'));
    expect(logout).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/login');
  });

  it('shows an inline error and does not log out or navigate when the request fails', async () => {
    deleteAccount.mockRejectedValue(new Error('Something went wrong'));
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('lets each person’s data be downloaded before deleting', () => {
    render(<DeleteAccountModal onClose={vi.fn()} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Download CSV' })[0]);
    expect(downloadPersonCsv).toHaveBeenCalledWith(1);
  });
});
