import { useState } from 'react';
import { createRoutine, updateRoutine } from '../../api/routines';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';

export default function RoutineFormModal({ personId, routine, exercises, onClose, onSaved }) {
  const isEditing = !!routine;
  const [name, setName] = useState(routine?.name || '');
  const [selectedIds, setSelectedIds] = useState(routine ? routine.exercises.map((e) => e.exerciseId) : []);

  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const available = exercises.filter((e) => !selectedIds.includes(e.id));

  function addExercise(id) {
    setSelectedIds((ids) => [...ids, id]);
  }
  function removeExercise(id) {
    setSelectedIds((ids) => ids.filter((x) => x !== id));
  }
  function moveExercise(index, dir) {
    setSelectedIds((ids) => {
      const arr = [...ids];
      const j = index + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[index], arr[j]] = [arr[j], arr[index]];
      return arr;
    });
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || selectedIds.length === 0) return;
    if (isEditing) {
      await updateRoutine(personId, routine.id, { name: trimmed, exerciseIds: selectedIds });
    } else {
      await createRoutine(personId, { name: trimmed, exerciseIds: selectedIds });
    }
    onSaved();
  }

  return (
    <Modal width={420} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{isEditing ? 'Edit routine' : 'New routine'}</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Routine name (e.g. Push Day)"
        style={{ width: '100%', boxSizing: 'border-box', padding: 14, border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 16, marginBottom: 16 }}
      />

      {selectedIds.length > 0 && (
        <>
          <div style={sectionLabelStyle}>In this routine</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {selectedIds.map((id, idx) => (
              <div
                key={id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-pr-bg)',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>{exerciseById.get(id)?.name}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => moveExercise(idx, -1)} style={miniButtonStyle}>
                    &uarr;
                  </button>
                  <button onClick={() => moveExercise(idx, 1)} style={miniButtonStyle}>
                    &darr;
                  </button>
                  <button onClick={() => removeExercise(id)} style={{ ...miniButtonStyle, color: 'var(--color-danger)' }}>
                    &times;
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {available.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Add exercise</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {available.map((ex) => (
              <button key={ex.id} onClick={() => addExercise(ex.id)} style={addChipStyle}>
                + {ex.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleSave}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          {isEditing ? 'Save' : 'Save routine'}
        </Button>
      </div>
    </Modal>
  );
}

const sectionLabelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 10,
};

const miniButtonStyle = {
  width: 32,
  height: 32,
  border: 'none',
  borderRadius: 8,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 14,
  cursor: 'pointer',
};

const addChipStyle = {
  padding: '9px 14px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
