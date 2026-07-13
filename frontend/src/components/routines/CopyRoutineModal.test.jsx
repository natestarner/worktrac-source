import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CopyRoutineModal from './CopyRoutineModal';
import { copyRoutine } from '../../api/routines';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';

vi.mock('../../api/routines', () => ({ copyRoutine: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

const routine = { id: 5, name: 'Push Day' };

const people = [
  { id: 1, name: 'Nate' },
  { id: 2, name: 'Sam' },
  { id: 3, name: 'Jordan' },
];

describe('CopyRoutineModal', () => {
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ people });
    useUI.mockReturnValue({ showToast });
    copyRoutine.mockResolvedValue([{ id: 6, name: 'Push Day' }]);
  });

  it('renders a checkbox for every other person, excluding the active person', () => {
    render(<CopyRoutineModal routine={routine} personId={1} onClose={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: 'Sam' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Jordan' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Nate' })).not.toBeInTheDocument();
  });

  it('shows a validation message and does not call copyRoutine when nothing is selected', async () => {
    render(<CopyRoutineModal routine={routine} personId={1} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByText('Select at least one person.')).toBeInTheDocument();
    expect(copyRoutine).not.toHaveBeenCalled();
  });

  it('calls copyRoutine with the selected target ids and closes on success', async () => {
    const onClose = vi.fn();
    render(<CopyRoutineModal routine={routine} personId={1} onClose={onClose} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sam' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Jordan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(copyRoutine).toHaveBeenCalledWith(1, 5, [2, 3]));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows a toast naming the target people on success', async () => {
    render(<CopyRoutineModal routine={routine} personId={1} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Copied "Push Day" to Sam'));
  });
});
