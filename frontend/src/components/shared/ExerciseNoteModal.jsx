import { useState } from 'react';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';

// Shared editor for both exercise note types (see ExerciseDetail.jsx): the standing
// per-person note and the per-session note. A blank save clears the note. Centered, like
// every other content modal (EditSetModal, CustomFieldEditorModal, ConfigureExerciseModal)
// -- align="bottom" is reserved for NumericKeypad, which replaces the stepper you just
// tapped in place; a note editor has no such anchor and reads as stuck/broken pinned to
// the bottom edge on a desktop-width screen.
export default function ExerciseNoteModal({ title, subtitle, initialNote, onClose, onSave }) {
  const [note, setNote] = useState(initialNote || '');

  async function handleSave() {
    await onSave(note.trim());
    onClose();
  }

  // A blank save already clears the note server-side, but requiring someone to
  // select-all-and-delete the text isn't an obvious way to remove one -- this is the
  // explicit one-tap equivalent, mirroring ConfigureExerciseModal's "Delete this exercise".
  async function handleDelete() {
    await onSave('');
    onClose();
  }

  return (
    <Modal width={420} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14 }}>{subtitle}</div>
      <textarea
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        rows={4}
        placeholder="Write a note..."
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          fontSize: 15,
          fontFamily: 'inherit',
          resize: 'vertical',
          marginBottom: 18,
        }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleSave}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          Save
        </Button>
      </div>
      {initialNote && (
        <Button onClick={handleDelete} style={{ ...cancelButtonStyle, width: '100%', color: 'var(--color-danger)', marginTop: 10 }}>
          Delete note
        </Button>
      )}
    </Modal>
  );
}
