import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddEditExerciseModal from './AddEditExerciseModal';
import { addExercise, favoriteExercise } from '../../api/exercises';

// Categories are per-person now, so the modal only collects a name (+ optional setup fields);
// a new exercise is created uncategorized and auto-favorited for the active person so it lands
// in their picker.
vi.mock('../../api/exercises', () => ({ addExercise: vi.fn(), updateExercise: vi.fn(), favoriteExercise: vi.fn() }));

function lastAddButton() {
  const addButtons = screen.getAllByRole('button', { name: 'Add' });
  return addButtons[addButtons.length - 1];
}

describe('AddEditExerciseModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addExercise.mockResolvedValue({ id: 7 });
    favoriteExercise.mockResolvedValue({});
  });

  it('creates an uncategorized exercise and auto-favorites it for the active person', async () => {
    const onSaved = vi.fn();
    render(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Cable Row' } });
    fireEvent.click(lastAddButton());

    await waitFor(() => expect(addExercise).toHaveBeenCalledWith({ name: 'Cable Row', setupFieldNames: [] }));
    await waitFor(() => expect(favoriteExercise).toHaveBeenCalledWith(5, 7));
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows an error and does not save when the name is blank', async () => {
    const onSaved = vi.fn();
    render(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(lastAddButton());

    expect(await screen.findByText('Enter an exercise name.')).toBeInTheDocument();
    expect(addExercise).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Cable Row' } });
    expect(screen.queryByText('Enter an exercise name.')).not.toBeInTheDocument();
  });
});
