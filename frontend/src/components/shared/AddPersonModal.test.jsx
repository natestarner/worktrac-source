import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddPersonModal from './AddPersonModal';
import { addPerson } from '../../api/people';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';

vi.mock('../../api/people', () => ({ addPerson: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));

describe('AddPersonModal validation', () => {
  let refreshPeople;
  let selectPerson;

  beforeEach(() => {
    vi.clearAllMocks();
    addPerson.mockResolvedValue({ id: 5 });
    refreshPeople = vi.fn().mockResolvedValue();
    selectPerson = vi.fn();
    useAuth.mockReturnValue({ refreshPeople });
    useAppState.mockReturnValue({ selectPerson });
  });

  it('shows an error and does not add a person when the name is blank', async () => {
    render(<AddPersonModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    expect(addPerson).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Sam' } });
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument();
  });

  it('adds the person once a name is provided', async () => {
    const onClose = vi.fn();
    render(<AddPersonModal onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addPerson).toHaveBeenCalledWith('Sam'));
    expect(selectPerson).toHaveBeenCalledWith(5);
    expect(onClose).toHaveBeenCalled();
  });
});
