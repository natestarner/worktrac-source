import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigureExerciseModal from './ConfigureExerciseModal';
import { setPersistentNote } from '../../api/notes';

vi.mock('../../api/exercises', () => ({
  addCustomField: vi.fn(),
  updateCustomField: vi.fn(),
  removeCustomField: vi.fn(),
  setExerciseTags: vi.fn(),
  updateExercise: vi.fn(),
}));

vi.mock('../../api/notes', () => ({
  setPersistentNote: vi.fn(),
}));

function renderModal(exercise) {
  return render(
    <ConfigureExerciseModal
      exercise={exercise}
      personId={1}
      exerciseId={exercise.id}
      allTags={[]}
      appliedTagNames={[]}
      customFields={[]}
      onClose={vi.fn()}
      onFieldsChanged={vi.fn()}
      onTagsChanged={vi.fn()}
      onExerciseChanged={vi.fn()}
      onRequestDelete={vi.fn()}
    />,
  );
}

describe('ConfigureExerciseModal ownership', () => {
  it('shows "Created by you" plus rename + delete for your own exercise', () => {
    renderModal({ id: 1, name: 'My Curl', isGlobal: false });

    expect(screen.getByText('Created by you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this exercise' })).toBeInTheDocument();
  });

  it('shows "Preloaded exercise" and no rename/delete for a shared exercise', () => {
    renderModal({ id: 2, name: 'Barbell Bench Press', isGlobal: true });

    expect(screen.getByText('Preloaded exercise')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this exercise' })).not.toBeInTheDocument();
  });
});

describe('ConfigureExerciseModal standing note', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the existing standing note, even for a preloaded (global) exercise', () => {
    renderModal({ id: 2, name: 'Barbell Bench Press', isGlobal: true, note: 'Bar is loaded to 45lb' });

    expect(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee -- go light')).toHaveValue('Bar is loaded to 45lb');
  });

  it('saves the standing note on blur', async () => {
    setPersistentNote.mockResolvedValue({ note: 'Keep elbows tucked' });
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: '' });

    const textarea = screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee -- go light');
    fireEvent.change(textarea, { target: { value: 'Keep elbows tucked' } });
    fireEvent.blur(textarea);

    await waitFor(() => expect(setPersistentNote).toHaveBeenCalledWith(1, 1, 'Keep elbows tucked'));
  });

  it('does not call the API when blurring without a change', () => {
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: 'Already saved' });

    fireEvent.blur(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee -- go light'));

    expect(setPersistentNote).not.toHaveBeenCalled();
  });
});
