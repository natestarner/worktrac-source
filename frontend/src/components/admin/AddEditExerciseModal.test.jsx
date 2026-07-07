import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddEditExerciseModal from './AddEditExerciseModal';
import { addExercise } from '../../api/exercises';

// AdminTab doesn't gate "+ Add exercise" behind categories having finished loading, so
// this modal can mount with an empty categories list. categoryId's default used to be
// computed once at mount (`categories[0]?.id`), which stuck at undefined forever if
// categories arrived a moment later -- silently turning Save into a no-op with no
// visible error. Two things guard against that now: categoryId backfills once
// categories load, AND the submit button stays disabled until categoryId is set, so a
// submit that races ahead of the backfill can't silently no-op either.
vi.mock('../../api/exercises', () => ({ addExercise: vi.fn(), updateExercise: vi.fn() }));

function lastAddButton() {
  const addButtons = screen.getAllByRole('button', { name: 'Add' });
  return addButtons[addButtons.length - 1];
}

describe('AddEditExerciseModal category default', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addExercise.mockResolvedValue({ id: 1 });
  });

  it('disables submit while no category is selected yet, and backfills once categories load', async () => {
    const onSaved = vi.fn();
    const { rerender } = render(
      <AddEditExerciseModal exercise={null} categories={[]} onClose={vi.fn()} onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Cable Row' } });
    expect(lastAddButton()).toBeDisabled();

    rerender(
      <AddEditExerciseModal exercise={null} categories={[{ id: 42, name: 'Upper Push' }]} onClose={vi.fn()} onSaved={onSaved} />,
    );

    await waitFor(() => expect(lastAddButton()).toBeEnabled());
    fireEvent.click(lastAddButton());

    await waitFor(() => expect(addExercise).toHaveBeenCalledWith({ name: 'Cable Row', categoryId: 42, setupFieldNames: [] }));
    expect(onSaved).toHaveBeenCalled();
  });
});
