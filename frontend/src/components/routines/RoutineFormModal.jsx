import { useEffect, useState } from 'react';
import { createRoutine, updateRoutine } from '../../api/routines';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';

export default function RoutineFormModal({ personId, routine, exercises, categories, onClose, onSaved }) {
  const isEditing = !!routine;
  const [name, setName] = useState(routine?.name || '');
  const [selectedIds, setSelectedIds] = useState(routine ? routine.exercises.map((e) => e.exerciseId) : []);
  const [exerciseFilter, setExerciseFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [nameError, setNameError] = useState(false);
  const [exercisesError, setExercisesError] = useState(false);

  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const term = exerciseFilter.trim().toLowerCase();
  const unselected = exercises.filter((e) => !selectedIds.includes(e.id));
  const available = unselected
    .filter((e) => categoryFilter === null || e.categoryId === categoryFilter)
    .filter((e) => !term || e.name.toLowerCase().includes(term));
  const availableCategories = (categories || []).filter((cat) => unselected.some((e) => e.categoryId === cat.id));

  // A category can empty out as its last remaining exercise gets added to the routine;
  // fall back to "All" rather than leaving the filter pointed at a pill that's no longer shown.
  useEffect(() => {
    if (categoryFilter !== null && !availableCategories.some((cat) => cat.id === categoryFilter)) {
      setCategoryFilter(null);
    }
  });

  function addExercise(id) {
    setSelectedIds((ids) => [...ids, id]);
    setExercisesError(false);
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
    const hasExercises = selectedIds.length > 0;
    if (!trimmed || !hasExercises) {
      setNameError(!trimmed);
      setExercisesError(!hasExercises);
      return;
    }
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
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(false);
        }}
        placeholder="Routine name (e.g. Push Day)"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: `1px solid ${nameError ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 10,
          fontSize: 16,
          marginBottom: nameError ? 6 : 16,
        }}
      />
      {nameError && <div style={errorTextStyle}>Give this routine a name.</div>}

      {selectedIds.length === 0 && exercisesError && <div style={{ ...errorTextStyle, marginBottom: 18 }}>Add at least one exercise.</div>}

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

      {(exercises.length - selectedIds.length > 0) && (
        <>
          <div style={sectionLabelStyle}>Add exercise</div>
          <input
            value={exerciseFilter}
            onChange={(e) => setExerciseFilter(e.target.value)}
            placeholder="Search exercises"
            style={{ width: '100%', boxSizing: 'border-box', padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 14, marginBottom: 10 }}
          />
          {availableCategories.length > 1 && (
            <div style={{ marginBottom: 14 }}>
              <div style={filterLabelStyle}>Filter by category</div>
              <div style={categoryTrackStyle}>
                <button onClick={() => setCategoryFilter(null)} style={categoryTabStyle(categoryFilter === null)}>
                  All
                </button>
                {availableCategories.map((cat) => (
                  <button key={cat.id} onClick={() => setCategoryFilter(cat.id)} style={categoryTabStyle(categoryFilter === cat.id)}>
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {available.length === 0 ? (
            <div style={{ padding: '10px 2px 18px', color: 'var(--color-faint)', fontSize: 14 }}>
              {term ? `No exercises match "${exerciseFilter}".` : 'No exercises in this category.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              {available.map((ex) => (
                <button key={ex.id} onClick={() => addExercise(ex.id)} style={addChipStyle}>
                  + {ex.name}
                </button>
              ))}
            </div>
          )}
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

const errorTextStyle = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-danger)',
  marginBottom: 16,
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

const filterLabelStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--color-faint)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 6,
};

const categoryTrackStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 2,
  padding: 3,
  background: 'var(--color-subtle-bg)',
  borderRadius: 10,
};

function categoryTabStyle(active) {
  return {
    padding: '6px 12px',
    borderRadius: 7,
    border: 'none',
    background: active ? 'var(--color-accent)' : 'transparent',
    color: active ? '#fff' : 'var(--color-muted)',
    fontSize: 13,
    fontWeight: active ? 700 : 600,
    cursor: 'pointer',
  };
}
