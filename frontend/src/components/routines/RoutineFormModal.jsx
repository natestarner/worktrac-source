import { useRef, useState } from 'react';
import SectionLabel from '../shared/SectionLabel';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createRoutine, updateRoutine } from '../../api/routines';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import AddEditExerciseModal from '../settings/AddEditExerciseModal';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';
import IconButton from '../shared/IconButton';
import { IconClose, IconGripVertical } from '../shared/icons';
import ExerciseSearchResults from '../shared/ExerciseSearchResults';
import { searchExercises } from '../../utils/exerciseSearch';
import { FIELD_LIMITS } from '../../utils/fieldLimits';

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
//
// Reordering has two independent input paths that both funnel into the same setRows: dragging a
// row's grip handle (mouse, touch or pen, via dnd-kit's PointerSensor) and pressing an arrow key
// while a handle is focused (hand-rolled, NOT dnd-kit's own KeyboardSensor -- that sensor derives
// the "next" slot from measured DOM rects, which jsdom never lays out, so a keyboard reorder
// driven by it would be unwritable as a unit test; calling the same moveExercise the old up/down
// buttons used keeps this path both real and testable). Only ONE sensor (Pointer) is registered
// on DndContext, so dnd-kit's own listeners never attach a keydown handler to the handle and
// there is nothing for our onKeyDown to collide with.
export default function RoutineFormModal({ personId, routine, personExercises, catalog, onClose, onSaved, onExerciseCreated }) {
  const isEditing = !!routine;
  const [name, setName] = useState(routine?.name || '');
  // Monotonic, modal-local, and never reused: a row's key has to survive reordering and stay
  // distinct from the other copies of the same exercise, so it can't be derived from the
  // exercise id or the index. It also doubles as the dnd-kit sortable id.
  const nextRowKey = useRef(0);
  const [rows, setRows] = useState(() =>
    routine ? routine.exercises.map((e) => ({ key: (nextRowKey.current += 1), exerciseId: e.exerciseId })) : [],
  );
  const [exerciseFilter, setExerciseFilter] = useState('');
  const [addingExercise, setAddingExercise] = useState(false);
  const [locallyCreated, setLocallyCreated] = useState([]);
  const [nameError, setNameError] = useState(false);
  const [exercisesError, setExercisesError] = useState(false);
  // dnd-kit's own DragOverlay content, and nothing else -- which row (if any) is mid-drag.
  const [activeId, setActiveId] = useState(null);
  // A single sr-only live region, updated by BOTH reorder paths below, so a screen-reader user
  // hears the same wording regardless of whether the move came from a drag or an arrow key.
  const [liveMessage, setLiveMessage] = useState('');
  const { run } = useGatedMutation();

  // A small activation distance -- not zero -- so a tap that lands on the handle but isn't
  // really a drag (a fat-fingered touch that moves a pixel or two) doesn't register as one.
  // The options object is hoisted (POINTER_SENSOR_OPTIONS below) rather than a literal here --
  // useSensor keys its memoization off THIS object's identity, so a fresh literal on every
  // render of a modal that re-renders on every keystroke made it rebuild the sensor, and with it
  // tear down and reattach dnd-kit's document-level pointer listeners, on every render.
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

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
  // The keyboard path: one step at a time, same semantics as the old dedicated up/down buttons.
  function moveExercise(index, dir) {
    setRows((list) => {
      const j = index + dir;
      if (j < 0 || j >= list.length) return list;
      const arr = [...list];
      [arr[index], arr[j]] = [arr[j], arr[index]];
      announceMove(arr[j].exerciseId, j, arr.length);
      return arr;
    });
  }
  function announceMove(exerciseId, newIndex, total) {
    const exerciseName = exerciseById.get(exerciseId)?.name;
    setLiveMessage(`${exerciseName} moved to position ${newIndex + 1} of ${total}.`);
  }

  // The pointer/touch path: dnd-kit reports the row dropped ON (`over`), which can be more than
  // one position away from where the drag started.
  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    setRows((list) => {
      const oldIndex = list.findIndex((row) => row.key === active.id);
      const newIndex = list.findIndex((row) => row.key === over.id);
      if (oldIndex === -1 || newIndex === -1) return list;
      const next = arrayMove(list, oldIndex, newIndex);
      announceMove(list[oldIndex].exerciseId, newIndex, next.length);
      return next;
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

  const activeRow = rows.find((row) => row.key === activeId);

  return (
    <Modal width={420} onClose={onClose} title={isEditing ? 'Edit routine' : 'New routine'}>
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(false);
        }}
        placeholder="Routine name (e.g. Push Day)"
        maxLength={FIELD_LIMITS.routineName}
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

      {/* Zero-sized and always mounted, per RefreshIndicator's pattern -- a screen reader only
          announces changes WITHIN an existing live region, so this can't be mounted on demand. */}
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {rows.length > 0 && (
        <>
          <SectionLabel>In this routine</SectionLabel>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            accessibility={dndAccessibility}
            onDragStart={(event) => setActiveId(event.active.id)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext items={rows.map((row) => row.key)} strategy={verticalListSortingStrategy}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                {rows.map((row, idx) => (
                  <SortableRoutineRow
                    key={row.key}
                    row={row}
                    index={idx}
                    total={rows.length}
                    exerciseName={exerciseById.get(row.exerciseId)?.name}
                    onRemove={removeExercise}
                    onMoveByKey={moveExercise}
                  />
                ))}
              </div>
            </SortableContext>
            {/* Rendered through dnd-kit's own portal, above everything -- including the modal's
                sticky header -- so a row dragged near either edge of the panel's own scroll area
                is never clipped by it. */}
            <DragOverlay>
              {activeRow ? (
                <div style={{ ...rowStyle, boxShadow: 'var(--shadow-4), var(--elevation-hairline)', cursor: 'grabbing' }}>
                  <span style={gripIconWrapperStyle} aria-hidden="true">
                    <IconGripVertical />
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}>{exerciseById.get(activeRow.exerciseId)?.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      <SectionLabel>Add exercise to routine</SectionLabel>
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
            <SectionLabel style={{ marginBottom: 'var(--space-2)' }}>{group.name}</SectionLabel>
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

const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };

// dnd-kit's default instructions describe ITS OWN keyboard sensor's pick-up/move/drop model.
// This modal deliberately doesn't register that sensor (see the file header comment), so the
// default text would describe a space-bar interaction that doesn't exist here -- override it
// with what a handle actually does.
const screenReaderInstructions = {
  draggable:
    "To reorder this exercise, press and drag its grip handle with a mouse or touch. Or, with the handle focused, press the up or down arrow key to move it one position at a time.",
};
// Passed to DndContext's `accessibility` prop. Hoisted so its identity is stable across
// RoutineFormModal's re-renders (every keystroke, every reorder) rather than a fresh object
// each time.
const dndAccessibility = { screenReaderInstructions };

// One row in the "In this routine" list. `setNodeRef`/`transform`/`transition` position the
// whole row as dnd-kit reorders the list; `attributes`/`listeners` (the drag activators) go on
// the handle ALONE, not the row -- otherwise the exercise name and the remove button would start
// a drag too, instead of just being read or tapped.
function SortableRoutineRow({ row, index, total, exerciseName, onRemove, onMoveByKey }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.key });
  // The x component is dropped -- this list only ever reorders vertically, and a slightly
  // diagonal drag shouldn't nudge the row sideways too.
  const style = {
    ...rowStyle,
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : transform),
    transition,
    // The dragged row's own place in the list becomes a faint placeholder -- the "real" copy is
    // the one following the pointer in the DragOverlay above.
    opacity: isDragging ? 0.4 : 1,
  };
  // Two rows for the same exercise are otherwise indistinguishable to a screen reader -- the
  // position is the only thing that separates them.
  const position = `${exerciseName} (${index + 1} of ${total})`;

  function handleKeyDown(event) {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMoveByKey(index, -1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMoveByKey(index, 1);
    }
  }

  return (
    <div ref={setNodeRef} style={style}>
      <IconButton
        {...attributes}
        {...listeners}
        ref={setActivatorNodeRef}
        onKeyDown={handleKeyDown}
        icon={IconGripVertical}
        label={`Reorder: ${position}`}
        style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      />
      <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}>{exerciseName}</span>
      <IconButton icon={IconClose} label={`Remove: ${position}`} tone="danger" onClick={() => onRemove(row.key)} />
    </div>
  );
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 6px 6px 10px',
  borderRadius: 10,
  border: '1px solid var(--color-border)',
  background: 'var(--color-pr-bg)',
};

// Matches the 40x40 footprint of the IconButton the DragOverlay clone stands in for, so the
// "lifted" card is the same size as the row it was picked up from.
const gripIconWrapperStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  flexShrink: 0,
  color: 'var(--color-muted)',
};


const hintStyle = { padding: '10px 2px 18px', color: 'var(--color-muted)', fontSize: 14 };

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
