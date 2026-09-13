import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    onlineManager.setOnline(true);
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

  it('shows the role as Account owner', () => {
    render(<ProfileTab />);

    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Account owner')).toBeInTheDocument();
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

  it('disables Edit, Remove, and Delete account while offline', () => {
    render(<ProfileTab />);

    act(() => onlineManager.setOnline(false));

    screen.getAllByRole('button', { name: 'Edit' }).forEach((btn) => expect(btn).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();

    onlineManager.setOnline(true);
  });

  // A member's Profile is a different screen, not the owner's with pieces greyed out. Household
  // management is MANAGE_PEOPLE / DELETE_ACCOUNT and unreachable for them, so it is hidden --
  // disabling is for something you could do under other circumstances.
  describe('as a member', () => {
    beforeEach(() => {
      useAuth.mockReturnValue({
        user: { id: 9, email: 'sam@example.com' },
        account: { id: 1, name: "The Starners' household", defaultUnit: 'lb' },
        membership: { accountRole: 'MEMBER', personId: 2, membersSeeEveryone: true },
        people: [
          { id: 1, name: 'Nate', isPrimary: true },
          { id: 2, name: 'Samuel', isPrimary: false },
        ],
        refreshPeople,
      });
    });

    // "Account holder" over the member's OWN email describes somebody else -- the bug this variant
    // exists to fix.
    it("shows their own identity, not the account holder's", () => {
      render(<ProfileTab />);

      expect(screen.getByText('You')).toBeInTheDocument();
      expect(screen.queryByText('Account holder')).not.toBeInTheDocument();
      expect(screen.getByText('Samuel')).toBeInTheDocument();
      expect(screen.getByText('sam@example.com')).toBeInTheDocument();
    });

    it('shows the role as Member', () => {
      render(<ProfileTab />);

      expect(screen.getByText('Role')).toBeInTheDocument();
      expect(screen.getByText('Member')).toBeInTheDocument();
    });

    it('hides the household roster and every control on it', () => {
      render(<ProfileTab />);

      expect(screen.queryByText('People')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });

    it('hides the danger zone entirely', () => {
      render(<ProfileTab />);

      expect(screen.queryByText('Danger zone')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });
  });
});
