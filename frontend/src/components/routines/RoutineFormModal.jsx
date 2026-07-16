import { useState } from 'react';
import { createRoutine, updateRoutine } from '../../api/routines';
import AddEditExerciseModal from '../settings/AddEditExerciseModal';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';

// Same favorites/logged-first-then-search model as the Log picker: the "Add exercise to
// routine" pool defaults to the person's own list (personExercises); typing a search reveals
// the whole catalog. Adding to a routine auto-favorites on the backend, so it also shows in
// the picker.
export default function RoutineFormModal({ personId, routine, personExercises, catalog, onClose, onSaved, onExerciseCreated }) {
  const isEditing = !!routine;
  const [name, setName] = useState(routine?.name || '');
  const [selectedIds, setSelectedIds] = useState(routine ? routine.exercises.map((e) => e.exerciseId) : []);
  const [exerciseFilter, setExerciseFilter] = useState('');
  const [addingExercise, setAddingExercise] = useState(false);
  const [locallyCreated, setLocallyCreated] = useState([]);
  const [nameError, setNameError] = useState(false);
  const [exercisesError, setExercisesError] = useState(false);

  // Names resolve against the full catalog (plus anything just created in this modal) so a
  // selected exercise always renders, whatever list it came from.
  const exerciseById = new Map([...catalog, ...locallyCreated].map((e) => [e.id, e]));
  const term = exerciseFilter.trim().toLowerCase();
  const searching = term.length > 0;
  const unselected = (e) => !selectedIds.includes(e.id);

  // Mirrors the Log picker: default view is the person's list split into "Favorites" and
  // "Other Previously Logged"; typing a search reveals the whole catalog (flat).
  const searchResults = searching ? catalog.filter((e) => unselected(e) && e.name.toLowerCase().includes(term)) : [];
  const favorites = personExercises.filter((e) => e.isFavorite && unselected(e));
  const otherLogged = personExercises.filter((e) => !e.isFavorite && unselected(e));
  const groups = [];
  if (favorites.length > 0) groups.push({ id: 'favorites', name: 'Favorites', items: favorites });
  if (otherLogged.length > 0) groups.push({ id: 'other', name: 'Other Previously Logged', items: otherLogged });

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

  async function handleExerciseCreated(created) {
    setLocallyCreated((list) => [...list, created]);
    setSelectedIds((ids) => (ids.includes(created.id) ? ids : [...ids, created.id]));
    setExercisesError(false);
    setExerciseFilter('');
    setAddingExercise(false);
    if (onExerciseCreated) await onExerciseCreated();
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

      <div style={sectionLabelStyle}>Add exercise to routine</div>
      <input
        value={exerciseFilter}
        onChange={(e) => setExerciseFilter(e.target.value)}
        placeholder="Search all exercises"
        style={{ width: '100%', boxSizing: 'border-box', padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 14, marginBottom: 14 }}
      />

      {searching ? (
        searchResults.length === 0 ? (
          <div style={hintStyle}>No exercises match "{exerciseFilter}".</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {searchResults.map((ex) => (
              <button key={ex.id} onClick={() => addExercise(ex.id)} style={addChipStyle}>
                + {ex.name}
              </button>
            ))}
          </div>
        )
      ) : groups.length === 0 ? (
        <div style={hintStyle}>Your favorited and logged exercises appear here. Search above to add any other exercise.</div>
      ) : (
        groups.map((group) => (
          <div key={group.id} style={{ marginBottom: 14 }}>
            <div style={groupLabelStyle}>{group.name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {group.items.map((ex) => (
                <button key={ex.id} onClick={() => addExercise(ex.id)} style={addChipStyle}>
                  + {ex.name}
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      <button onClick={() => setAddingExercise(true)} style={addOwnButtonStyle}>
        + Add your own exercise
      </button>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
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

      {addingExercise && (
        <AddEditExerciseModal
          exercise={null}
          personId={personId}
          initialName={exerciseFilter.trim()}
          onClose={() => setAddingExercise(false)}
          onSaved={handleExerciseCreated}
        />
      )}
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

const groupLabelStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--color-faint)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 8,
};

const hintStyle = { padding: '10px 2px 18px', color: 'var(--color-faint)', fontSize: 14 };

const addOwnButtonStyle = {
  width: '100%',
  marginTop: 4,
  marginBottom: 4,
  padding: 12,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
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
