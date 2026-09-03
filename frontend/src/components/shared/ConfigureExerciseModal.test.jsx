import { onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigureExerciseModal from './ConfigureExerciseModal';
import { setPersistentNote } from '../../api/notes';
import { useUI } from '../../context/UIContext';

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

vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

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
  beforeEach(() => {
    onlineManager.setOnline(true);
    useUI.mockReturnValue({ showToast: vi.fn() });
  });
  afterEach(() => onlineManager.setOnline(true));

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
    onlineManager.setOnline(true);
    useUI.mockReturnValue({ showToast: vi.fn() });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('prefills the existing standing note, even for a preloaded (global) exercise', () => {
    renderModal({ id: 2, name: 'Barbell Bench Press', isGlobal: true, note: 'Bar is loaded to 45lb' });

    expect(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light')).toHaveValue('Bar is loaded to 45lb');
  });

  it('saves the standing note on blur', async () => {
    setPersistentNote.mockResolvedValue({ note: 'Keep elbows tucked' });
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: '' });

    const textarea = screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light');
    fireEvent.change(textarea, { target: { value: 'Keep elbows tucked' } });
    fireEvent.blur(textarea);

    await waitFor(() => expect(setPersistentNote).toHaveBeenCalledWith(1, 1, 'Keep elbows tucked'));
  });

  it('does not call the API when blurring without a change', () => {
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: 'Already saved' });

    fireEvent.blur(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light'));

    expect(setPersistentNote).not.toHaveBeenCalled();
  });
});

describe('ConfigureExerciseModal offline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUI.mockReturnValue({ showToast: vi.fn() });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('still opens and shows the current name/note/tags/fields while offline', () => {
    onlineManager.setOnline(false);
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: 'Go light' });

    expect(screen.getByDisplayValue('My Curl')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light')).toHaveValue('Go light');
  });

  it('disables every edit control and shows an offline note while offline', () => {
    onlineManager.setOnline(false);
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: 'Go light' });

    expect(screen.getByText(/Editing needs a connection/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('My Curl')).toBeDisabled();
    expect(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete this exercise' })).toBeDisabled();
  });

  it('re-enables every control once back online', () => {
    onlineManager.setOnline(false);
    const { rerender } = renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: '' });
    onlineManager.setOnline(true);
    rerender(
      <ConfigureExerciseModal
        exercise={{ id: 1, name: 'My Curl', isGlobal: false, note: '' }}
        personId={1}
        exerciseId={1}
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

    expect(screen.queryByText(/Editing needs a connection/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('My Curl')).not.toBeDisabled();
  });
});
