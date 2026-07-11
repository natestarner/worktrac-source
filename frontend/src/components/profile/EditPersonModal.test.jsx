import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditPersonModal from './EditPersonModal';
import { updatePerson } from '../../api/people';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../api/people', () => ({ updatePerson: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

describe('EditPersonModal validation', () => {
  let refreshPeople;

  beforeEach(() => {
    vi.clearAllMocks();
    updatePerson.mockResolvedValue({ id: 3, name: 'Sam' });
    refreshPeople = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ refreshPeople });
  });

  it('pre-fills the input with the person\'s current name', () => {
    render(<EditPersonModal person={{ id: 3, name: 'Sam' }} onClose={vi.fn()} />);

    expect(screen.getByDisplayValue('Sam')).toBeInTheDocument();
  });

  it('shows an error and does not save when the name is cleared', async () => {
    render(<EditPersonModal person={{ id: 3, name: 'Sam' }} onClose={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue('Sam'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    expect(updatePerson).not.toHaveBeenCalled();
  });

  it('saves the new name once provided', async () => {
    const onClose = vi.fn();
    render(<EditPersonModal person={{ id: 3, name: 'Sam' }} onClose={onClose} />);

    fireEvent.change(screen.getByDisplayValue('Sam'), { target: { value: 'Samuel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updatePerson).toHaveBeenCalledWith(3, 'Samuel'));
    expect(refreshPeople).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
