import { useRef, useState } from 'react';
import { createRoutine, updateRoutine } from '../../api/routines';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import AddEditExerciseModal from '../settings/AddEditExerciseModal';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';
import ExerciseSearchResults from '../shared/ExerciseSearchResults';
import { searchExercises } from '../../utils/exerciseSearch';

// Same favorites/logged-first-then-search model as the Log picker: the "Add exercise to
// routine" pool defaults to the person's own list (personExercises); typing a search reveals
// the whole catalog. Adding to a routine auto-favorites on the backend, so it also shows in
// the picker.
//
// The same exercise may appear in a routine more than once -- a routine is meant to walk you
// through a whole workout, and plenty of workouts cycle back (bench, row, bench). That is why
// the routine's contents are a list of OCCURRENCES ({ key, exerciseId }) rather than a set of
// exercise ids: every operation below (remove, reorder, React keys) has to address one
// position, not "every row for this exercise". Nothing on the backend ever restricted this --
// routine_exercises has no unique index on (routine_id, exercise_id) and sort_order is assigned
// by list position -- the whole restriction was the picker filter this used to apply.
export default function RoutineFormModal({ personId, routine, personExercises, catalog, onClose, onSaved, onExerciseCreated }) {
  const isEditing = !!routine;
  const [name, setName] = useState(routine?.name || '');
  // Monotonic, modal-local, and never reused: a row's key has to survive reordering and stay
  // distinct from the other copies of the same exercise, so it can't be derived from the
  // exercise id or the index.
  const nextRowKey = useRef(0);
  const [rows, setRows] = useState(() =>
    routine ? routine.exercises.map((e) => ({ key: (nextRowKey.current += 1), exerciseId: e.exerciseId })) : [],
  );
  const [exerciseFilter, setExerciseFilter] = useState('');
  const [addingExercise, setAddingExercise] = useState(false);
  const [locallyCreated, setLocallyCreated] = useState([]);
  const [nameError, setNameError] = useState(false);
  const [exercisesError, setExercisesError] = useState(false);
  const { run } = useGatedMutation();

  // Names resolve against the full catalog (plus anything just created in this modal) so a
  // selected exercise always renders, whatever list it came from.
  const exerciseById = new Map([...catalog, ...locallyCreated].map((e) => [e.id, e]));
  const term = exerciseFilter.trim().toLowerCase();
  const searching = term.length > 0;

  // Mirrors the Log picker: default view is the person's list split into "Favorites" and
  // "Other Previously Logged"; typing a search reveals the whole catalog, ranked. Already-added
  // exercises deliberately STAY in these lists -- tapping one again adds a second occurrence.
  const searchResults = searching ? searchExercises(catalog, exerciseFilter) : [];
  const favorites = personExercises.filter((e) => e.isFavorite);
  const otherLogged = personExercises.filter((e) => !e.isFavorite);
  const groups = [];
  if (favorites.length > 0) groups.push({ id: 'favorites', name: 'Favorites', items: favorites });
  if (otherLogged.length > 0) groups.push({ id: 'other', name: 'Other Previously Logged', items: otherLogged });

  function addExercise(id) {
    setRows((list) => [...list, { key: (nextRowKey.current += 1), exerciseId: id }]);
    setExercisesError(false);
    setExerciseFilter('');
  }
  // By row key, not exercise id -- filtering on the id would drop every copy at once.
  function removeExercise(key) {
    setRows((list) => list.filter((row) => row.key !== key));
  }
  function moveExercise(index, dir) {
    setRows((list) => {
      const arr = [...list];
      const j = index + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[index], arr[j]] = [arr[j], arr[index]];
      return arr;
    });
  }

  async function handleExerciseCreated(created) {
    setLocallyCreated((list) => [...list, created]);
    addExercise(created.id);
    setAddingExercise(false);
    if (onExerciseCreated) await onExerciseCreated();
  }

  // Routine CRUD is Tier-3 (online-gated): createRoutine/updateRoutine are not idempotent, so they
  // must never be queued for replay. Previously this had no error path at all -- Button swallows a
  // rejected onClick by design, so a failed save just stopped with the modal open and no message.
  const handleSave = run(
    async () => {
      const trimmed = name.trim();
      const hasExercises = rows.length > 0;
      if (!trimmed || !hasExercises) {
        setNameError(!trimmed);
        setExercisesError(!hasExercises);
        return;
      }
      // Duplicates are preserved in order -- the backend stores one routine_exercises row per
      // position, numbered by sort_order.
      const exerciseIds = rows.map((row) => row.exerciseId);
      if (isEditing) {
        await updateRoutine(personId, routine.id, { name: trimmed, exerciseIds });
      } else {
        await createRoutine(personId, { name: trimmed, exerciseIds });
      }
      onSaved();
    },
    {
      offlineMessage: 'Saving a routine needs a connection.',
      errorMessage: "Couldn't save that routine.",
    },
  );

  return (
    <Modal width={420} onClose={onClose} title={isEditing ? 'Edit routine' : 'New routine'}>
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

      {rows.length === 0 && exercisesError && <div style={{ ...errorTextStyle, marginBottom: 18 }}>Add at least one exercise.</div>}

      {rows.length > 0 && (
        <>
          <div style={sectionLabelStyle}>In this routine</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {rows.map((row, idx) => {
              const exerciseName = exerciseById.get(row.exerciseId)?.name;
              // Two rows for the same exercise are otherwise indistinguishable to a screen
              // reader -- these three controls had no accessible name at all before (their
              // labels are the glyphs), so the position is the only thing that separates them.
              const position = `${exerciseName} (${idx + 1} of ${rows.length})`;
              return (
                <div
                  key={row.key}
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
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{exerciseName}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => moveExercise(idx, -1)} aria-label={`Move up: ${position}`} style={miniButtonStyle}>
                      &uarr;
                    </button>
                    <button onClick={() => moveExercise(idx, 1)} aria-label={`Move down: ${position}`} style={miniButtonStyle}>
                      &darr;
                    </button>
                    <button
                      onClick={() => removeExercise(row.key)}
                      aria-label={`Remove: ${position}`}
                      style={{ ...miniButtonStyle, color: 'var(--color-danger)' }}
                    >
                      &times;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={sectionLabelStyle}>Add exercise to routine</div>
      {/* fontSize must stay >=16px -- below that, iOS Safari auto-zooms on focus and doesn't
          reliably zoom back out (see ExercisePicker.jsx's search input for the full story). */}
      <input
        value={exerciseFilter}
        onChange={(e) => setExerciseFilter(e.target.value)}
        placeholder="Search all exercises"
        style={{ width: '100%', boxSizing: 'border-box', padding: 12, border: '1px solid var(--color-border)', borderRadius: 10, fontSize: 16, marginBottom: 14 }}
      />

      {searching ? (
        <ExerciseSearchResults
          results={searchResults}
          term={exerciseFilter}
          onSelect={addExercise}
          emptyMessage={`No exercises match "${exerciseFilter}".`}
        />
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
          requireSyncedExercise
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
