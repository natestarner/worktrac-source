import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';
import { useRoutines } from '../../hooks/useRoutines';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { removeRoutine, reorderRoutines } from '../../api/routines';
import RoutineFormModal from './RoutineFormModal';
import CopyRoutineModal from './CopyRoutineModal';
import Skeleton from '../shared/Skeleton';
import RefreshIndicator from '../shared/RefreshIndicator';
import OfflineDataNotice from '../shared/OfflineDataNotice';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import EmptyState from '../shared/EmptyState';
import Card from '../shared/Card';
import IconButton from '../shared/IconButton';
import { IconClipboardList, IconGripVertical } from '../shared/icons';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

// Routines are listed in the person's OWN order (routines.sort_order, V61/V62), which they set
// here by dragging. It replaced created_at ASC -- oldest first -- which put the routine someone
// built first at the top of this list and of the Log picker's quick-start block, and their
// current program at the bottom.
//
// Reordering is a MODE rather than always-visible grip handles. Two reasons, and both matter:
// a row already carries Copy to… / Edit / Delete / Start routine, and a fifth control on a phone
// is too many; and routine CRUD is Tier-3 (online-gated), so a mode gives exactly ONE control to
// OfflineDisabledWrap instead of a handle per row.
//
// The mode holds a local draft and commits ONE request on Done -- the same local-rows-then-save
// shape RoutineFormModal uses for the exercises inside a routine. A failed commit keeps the mode
// open with the draft intact (useGatedMutation has already shown the toast), so a dropped
// connection never costs the arrangement someone just built.
export default function RoutinesTab() {
  const navigate = useNavigate();
  const { activePersonId, startRoutine } = useAppState();
  const { people } = useAuth();
  const { openConfirm } = useUI();
  const { exercises: catalog, refetch: refetchCatalog } = useExercises();
  const { exercises: personExercises, refetch: refetchPersonExercises } = usePersonExercises(activePersonId);
  const { routines, loading, isFetching, refetch, updatedAt } = useRoutines(activePersonId);
  const [modalRoutine, setModalRoutine] = useState(undefined); // undefined = closed, null = create, object = edit
  const [copyRoutine, setCopyRoutine] = useState(null); // null = closed, object = routine being copied
  // null = not reordering. An array = the working order, held locally so a background refetch
  // can't yank the list out from under a drag.
  const [draftOrder, setDraftOrder] = useState(null);
  // dnd-kit's DragOverlay content, and nothing else -- which row (if any) is mid-drag.
  const [activeId, setActiveId] = useState(null);
  // One sr-only live region fed by BOTH reorder paths, so a screen-reader user hears the same
  // wording whether the move came from a drag or an arrow key.
  const [liveMessage, setLiveMessage] = useState('');
  const hasOtherPeople = people.some((p) => p.id !== activePersonId);
  const { run } = useGatedMutation();
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  const reordering = draftOrder !== null;
  const rows = reordering ? draftOrder : routines;

  // The draft describes THIS person's routines, so switching people has to abandon it rather
  // than carry one person's arrangement onto another's list. RoutinesTab is not remounted on a
  // person switch (AppShell just navigates to that person's lastTab, which can be this one).
  useEffect(() => {
    setDraftOrder(null);
    setActiveId(null);
    setLiveMessage('');
  }, [activePersonId]);

  function handleStart(routine) {
    startRoutine(routine.id, routine.exercises.map((e) => e.exerciseId));
    navigate('/app/log');
  }

  // Had no try/catch at all: a failed delete rejected into nothing, the row stayed on screen, and
  // the person had no idea it hadn't happened.
  const handleDelete = run(
    async (routine) => {
      await removeRoutine(activePersonId, routine.id);
      refetch();
    },
    {
      offlineMessage: 'Deleting a routine needs a connection.',
      errorMessage: "Couldn't delete that routine.",
    },
  );

  // Returns a truthy value only on success. `run` swallows both the offline refusal and a failed
  // write and resolves `undefined` in each case -- which is exactly the signal needed here, since
  // both mean "stay in reorder mode and keep the draft".
  const commitOrder = run(
    async (order) => {
      await reorderRoutines(activePersonId, order.map((r) => r.id));
      refetch();
      return true;
    },
    {
      offlineMessage: 'Reordering routines needs a connection.',
      errorMessage: "Couldn't save that order.",
    },
  );

  async function handleDone() {
    const unchanged =
      draftOrder.length === routines.length && draftOrder.every((r, i) => r.id === routines[i].id);
    // Opening the mode and closing it again is not a write. Skipping it also means the gate never
    // refuses a no-op offline, which would read as "reordering is broken".
    if (unchanged) {
      setDraftOrder(null);
      return;
    }
    if (await commitOrder(draftOrder)) setDraftOrder(null);
  }

  function announceMove(name, newIndex, total) {
    setLiveMessage(`${name} moved to position ${newIndex + 1} of ${total}.`);
  }

  // The keyboard path: one step at a time, mirroring RoutineFormModal's hand-rolled arrow keys
  // rather than dnd-kit's KeyboardSensor (that sensor derives the next slot from measured DOM
  // rects, which jsdom never lays out, so it would be untestable as a unit test).
  function moveRoutine(index, dir) {
    setDraftOrder((list) => {
      const j = index + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[index], next[j]] = [next[j], next[index]];
      announceMove(next[j].name, j, next.length);
      return next;
    });
  }

  // The pointer/touch path: dnd-kit reports the row dropped ON (`over`), which can be more than
  // one position away from where the drag started.
  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    setDraftOrder((list) => {
      const oldIndex = list.findIndex((r) => r.id === active.id);
      const newIndex = list.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return list;
      const next = arrayMove(list, oldIndex, newIndex);
      announceMove(list[oldIndex].name, newIndex, next.length);
      return next;
    });
  }

  const activeRoutine = activeId == null ? null : rows.find((r) => r.id === activeId);

  return (
    <div>
      {!reordering && (
        <OfflineDisabledWrap message="Creating a routine needs a connection.">
          <button onClick={() => setModalRoutine(null)} data-tour-anchor={TOUR_ANCHORS.NEW_ROUTINE} style={newRoutineButtonStyle}>
            + New routine
          </button>
        </OfflineDisabledWrap>
      )}

      {/* One routine can't be reordered, so the control only earns its place at two or more. */}
      {!loading && routines.length > 1 && (
        <div style={reorderBarStyle}>
          {reordering ? (
            <button onClick={handleDone} style={reorderToggleStyle}>
              Done
            </button>
          ) : (
            <OfflineDisabledWrap message="Reordering routines needs a connection.">
              {/* "Reorder routines", not "Reorder": Playwright matches an accessible name by
                  SUBSTRING, and every grip handle below is labelled "Reorder: <name> (n of m)".
                  A bare "Reorder" therefore matches this control AND all N handles the moment
                  the mode is open -- a strict-mode violation, and exactly the mutually-containing
                  labels frontend-core.md warns about. */}
              <button onClick={() => setDraftOrder(routines)} style={reorderToggleStyle}>
                Reorder routines
              </button>
            </OfflineDisabledWrap>
          )}
        </div>
      )}

      <RefreshIndicator show={isFetching && !loading} />
      <OfflineDataNotice updatedAt={updatedAt} />

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Skeleton width={140} height={16} />
                <div style={{ display: 'flex', gap: 14 }}>
                  <Skeleton width={28} height={13} />
                  <Skeleton width={44} height={13} />
                </div>
              </div>
              <Skeleton width={200} height={13} style={{ marginBottom: 14 }} />
              <Skeleton width={144} height={41} radius={10} />
            </Card>
          ))}
        </div>
      )}

      {!loading && routines.length === 0 && (
        <EmptyState
          icon={IconClipboardList}
          title="No routines yet."
          body="Build one from your exercise library and starting a workout is one tap."
        />
      )}

      {/* Zero-sized and always mounted, per RefreshIndicator's pattern -- a screen reader only
          announces changes WITHIN an existing live region, so this can't be mounted on demand. */}
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {!loading && reordering && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={dndAccessibility}
          onDragStart={(event) => setActiveId(event.active.id)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map((r, idx) => (
                <SortableRoutineRow
                  key={r.id}
                  routine={r}
                  index={idx}
                  total={rows.length}
                  onMoveByKey={moveRoutine}
                />
              ))}
            </div>
          </SortableContext>
          {/* Rendered through dnd-kit's own portal, above everything, so a row dragged near
              either edge is never clipped by an ancestor's overflow. */}
          <DragOverlay>
            {activeRoutine ? (
              <div style={{ ...reorderRowStyle, boxShadow: 'var(--shadow-4), var(--elevation-hairline)', cursor: 'grabbing' }}>
                <span style={gripIconWrapperStyle} aria-hidden="true">
                  <IconGripVertical />
                </span>
                <span style={reorderRowNameStyle}>{activeRoutine.name}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!loading && !reordering && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {routines.map((r) => (
            <Card key={r.id}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{r.name}</div>
                <div style={{ display: 'flex', gap: 14 }}>
                  {hasOtherPeople && (
                    <OfflineDisabledWrap message="Copying a routine needs a connection.">
                      <button onClick={() => setCopyRoutine(r)} style={editLinkStyle}>
                        Copy to&hellip;
                      </button>
                    </OfflineDisabledWrap>
                  )}
                  <OfflineDisabledWrap message="Editing a routine needs a connection.">
                    <button onClick={() => setModalRoutine(r)} style={editLinkStyle}>
                      Edit
                    </button>
                  </OfflineDisabledWrap>
                  <OfflineDisabledWrap message="Deleting a routine needs a connection.">
                    <button
                      onClick={() => openConfirm(`Delete "${r.name}"? This can't be undone.`, () => handleDelete(r))}
                      style={deleteLinkStyle}
                    >
                      Delete
                    </button>
                  </OfflineDisabledWrap>
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14 }}>
                {r.exercises.map((e) => e.exerciseName).join(', ')}
              </div>
              <button onClick={() => handleStart(r)} style={startButtonStyle}>
                Start routine
              </button>
            </Card>
          ))}
        </div>
      )}

      {modalRoutine !== undefined && (
        <RoutineFormModal
          personId={activePersonId}
          routine={modalRoutine}
          personExercises={personExercises}
          catalog={catalog}
          onExerciseCreated={() => Promise.all([refetchCatalog(), refetchPersonExercises()])}
          onClose={() => setModalRoutine(undefined)}
          onSaved={() => {
            setModalRoutine(undefined);
            refetch();
          }}
        />
      )}

      {copyRoutine && (
        <CopyRoutineModal routine={copyRoutine} personId={activePersonId} onClose={() => setCopyRoutine(null)} />
      )}
    </div>
  );
}

// Hoisted rather than a literal at the useSensor call: useSensor keys its memoization off this
// object's IDENTITY, so a fresh literal every render rebuilds the sensor and with it tears down
// and reattaches dnd-kit's document-level pointer listeners. Same reasoning as RoutineFormModal.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };

// dnd-kit's default instructions describe ITS OWN keyboard sensor's pick-up/move/drop model, and
// that sensor is deliberately not registered here -- so the default text would describe a
// space-bar interaction that doesn't exist.
const screenReaderInstructions = {
  draggable:
    'To reorder this routine, press and drag its grip handle with a mouse or touch. Or, with the handle focused, press the up or down arrow key to move it one position at a time.',
};
const dndAccessibility = { screenReaderInstructions };

// `setNodeRef`/`transform`/`transition` position the whole row as dnd-kit reorders the list;
// `attributes`/`listeners` (the drag activators) go on the HANDLE alone via setActivatorNodeRef.
// That separation is what lets a distance-4 PointerSensor coexist with page scrolling -- this is
// a full scrolling tab, not a modal, so a row-wide activator would fight every scroll gesture.
function SortableRoutineRow({ routine, index, total, onMoveByKey }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: routine.id,
  });
  // The x component is dropped -- this list only ever reorders vertically, and a slightly
  // diagonal drag shouldn't nudge the row sideways too.
  const style = {
    ...reorderRowStyle,
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const position = `${routine.name} (${index + 1} of ${total})`;

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
      <span style={reorderRowNameStyle}>{routine.name}</span>
    </div>
  );
}

const newRoutineButtonStyle = {
  width: '100%',
  padding: 16,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 14,
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  marginBottom: 16,
};

const reorderBarStyle = { display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' };

const reorderToggleStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 'var(--space-2)',
};

const reorderRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 6px 6px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
};

const reorderRowNameStyle = { fontSize: 15, fontWeight: 600, flex: 1, minWidth: 0 };

// Matches the 40x40 footprint of the IconButton the DragOverlay clone stands in for, so the
// "lifted" row is the same size as the one it was picked up from.
const gripIconWrapperStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  flexShrink: 0,
  color: 'var(--color-muted)',
};

const editLinkStyle = { background: 'none', border: 'none', color: 'var(--color-accent-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const deleteLinkStyle = { background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

const startButtonStyle = {
  padding: '12px 20px',
  background: 'var(--color-accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};
