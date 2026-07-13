import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileTab from './ProfileTab';
import { removePerson, updatePerson } from '../../api/people';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../api/people', () => ({ removePerson: vi.fn(), updatePerson: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

describe('ProfileTab', () => {
  let refreshPeople;
  let openConfirm;

  beforeEach(() => {
    vi.clearAllMocks();
    refreshPeople = vi.fn().mockResolvedValue();
    openConfirm = vi.fn((message, onConfirm) => onConfirm());
    removePerson.mockResolvedValue();
    updatePerson.mockResolvedValue({ id: 2, name: 'Sam' });
    useUI.mockReturnValue({ openConfirm });
    useAuth.mockReturnValue({
      user: { id: 1, email: 'nate@example.com' },
      account: { id: 1, name: "The Starners' household", defaultUnit: 'lb' },
      people: [
        { id: 1, name: 'Nate', isPrimary: true },
        { id: 2, name: 'Samuel', isPrimary: false },
      ],
      refreshPeople,
    });
  });

  it('shows the primary account holder, household name, and email', () => {
    render(<ProfileTab />);

    expect(screen.getByText("The Starners' household")).toBeInTheDocument();
    expect(screen.getByText('nate@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Nate').length).toBeGreaterThan(0);
  });

  it('lists everyone on the account with a PRIMARY badge on the primary person', () => {
    render(<ProfileTab />);

    expect(screen.getByText('Samuel')).toBeInTheDocument();
    expect(screen.getByText('PRIMARY')).toBeInTheDocument();
  });

  it('navigates back when Back is clicked', () => {
    render(<ProfileTab />);

    fireEvent.click(screen.getByRole('button', { name: /Back/ }));

    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('only shows a Remove option for non-primary people', () => {
    render(<ProfileTab />);

    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
  });

  it('removes a non-primary person after confirming', async () => {
    render(<ProfileTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(removePerson).toHaveBeenCalledWith(2));
    expect(refreshPeople).toHaveBeenCalled();
  });

  it('opens an edit modal for a person, including the primary person, and saves the new name', async () => {
    render(<ProfileTab />);

    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    fireEvent.click(editButtons[0]);

    const input = screen.getByDisplayValue('Nate');
    fireEvent.change(input, { target: { value: 'Nathaniel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updatePerson).toHaveBeenCalledWith(1, 'Nathaniel'));
    expect(refreshPeople).toHaveBeenCalled();
  });
});
