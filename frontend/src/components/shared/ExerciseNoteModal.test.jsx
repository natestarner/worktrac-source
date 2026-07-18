import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExerciseNoteModal from './ExerciseNoteModal';

describe('ExerciseNoteModal', () => {
  it('prefills the existing note and saves the trimmed value', async () => {
    const onSave = vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    render(
      <ExerciseNoteModal
        title="Note for this session"
        subtitle="Just for today"
        initialNote="Shoulder felt off today"
        onClose={onClose}
        onSave={onSave}
      />,
    );

    const textarea = screen.getByPlaceholderText('Write a note...');
    expect(textarea).toHaveValue('Shoulder felt off today');

    fireEvent.change(textarea, { target: { value: '  Cut it short today  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Cut it short today'));
    expect(onClose).toHaveBeenCalled();
  });

  it('saving a blank textarea clears the note', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(<ExerciseNoteModal title="Note" subtitle="" initialNote="Old note" onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText('Write a note...'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(''));
  });

  it('cancel closes without saving', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ExerciseNoteModal title="Note" subtitle="" initialNote="" onClose={onClose} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers no delete action when there is no existing note', () => {
    render(<ExerciseNoteModal title="Note" subtitle="" initialNote="" onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Delete note' })).not.toBeInTheDocument();
  });

  it('Delete note clears the note in one tap, regardless of unsaved textarea edits', async () => {
    const onSave = vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    render(<ExerciseNoteModal title="Note" subtitle="" initialNote="Old note" onClose={onClose} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText('Write a note...'), { target: { value: 'a half-typed edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(''));
    expect(onClose).toHaveBeenCalled();
  });
});
