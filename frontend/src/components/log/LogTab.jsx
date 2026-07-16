import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';
import { usePersonCategories } from '../../hooks/usePersonCategories';
import { useRoutines } from '../../hooks/useRoutines';
import { useLiveSession } from '../../hooks/useLiveSession';
import { useHistory } from '../../hooks/useHistory';
import { editSession } from '../../api/sessions';
import { formatTime, localDateTimeToIso, toLocalDateStr, toLocalTimeStr } from '../../utils/datetime';
import ExercisePicker from './ExercisePicker';
import ExerciseDetail from './ExerciseDetail';
import SessionSummary from './SessionSummary';
import EndWorkoutConfirmModal from '../shared/EndWorkoutConfirmModal';
import AddEditExerciseModal from '../settings/AddEditExerciseModal';

export default function LogTab() {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const {
    activePersonId,
    selectedExerciseId,
    activeRoutineId,
    routineIndex,
    editingSession,
    selectExercise,
    backToPicker,
    startRoutine,
    jumpToRoutineIndex,
    nextExerciseInRoutine,
    endRoutine,
    doneEditingSession,
    updateEditingSession,
    setExerciseSearch,
  } = useAppState();

  const {
    exercises: personExercises,
    loading: personExercisesLoading,
    refetch: refetchPersonExercises,
  } = usePersonExercises(activePersonId);
  const { categories: personCategories, refetch: refetchPersonCategories } = usePersonCategories(activePersonId);
  // The full catalog powers search and lets us resolve a search-selected exercise that isn't
  // in the person's list yet.
  const { exercises: catalog, refetch: refetchCatalog } = useExercises();
  const { routines } = useRoutines(activePersonId);
  const { session: liveSession, refetch: refetchLiveSession } = useLiveSession(activePersonId);
  const activeSessionId = editingSession?.id || liveSession?.id || null;
  const { history, loading: historyLoading, refetch: refetchHistory } = useHistory(activeSessionId ? activePersonId : null);
  const [showEndWorkoutConfirm, setShowEndWorkoutConfirm] = useState(false);
  const [addExerciseName, setAddExerciseName] = useState(null); // null = closed; string = create modal prefilled with this name

  const activeRoutine = activeRoutineId ? routines.find((r) => r.id === activeRoutineId) : null;
  const selectedExercise = selectedExerciseId
    ? personExercises.find((e) => e.id === selectedExerciseId) || catalog.find((e) => e.id === selectedExerciseId) || null
    : null;
  const sessionEntries = activeSessionId ? history.find((s) => s.id === activeSessionId)?.entries ?? [] : [];

  useEffect(() => {
    if (activeSessionId && !selectedExerciseId) refetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, selectedExerciseId]);

  // Returning to the picker refreshes the person's list so a just-logged exercise (or a
  // favorite/category change made on the detail screen) shows up.
  useEffect(() => {
    if (!selectedExerciseId) refetchPersonExercises();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExerciseId]);

  async function refreshPersonalization() {
    await Promise.all([refetchPersonExercises(), refetchPersonCategories(), refetchCatalog()]);
  }

  async function handleExerciseCreated(created) {
    setAddExerciseName(null);
    setExerciseSearch('');
    await refetchPersonExercises();
    if (created?.id) selectExercise(created.id);
  }

  async function handleEditingDateChange(e) {
    const iso = localDateTimeToIso(e.target.value, toLocalTimeStr(editingSession.startedAt));
    const updated = await editSession(editingSession.id, iso);
    updateEditingSession(updated);
  }
  async function handleEditingTimeChange(e) {
    const iso = localDateTimeToIso(toLocalDateStr(editingSession.startedAt), e.target.value);
    const updated = await editSession(editingSession.id, iso);
    updateEditingSession(updated);
  }

  function handleStartRoutine(routine) {
    startRoutine(routine.id, routine.exercises.map((e) => e.exerciseId));
  }

  function handleNextExercise() {
    if (!activeRoutine) return;
    const exerciseIds = activeRoutine.exercises.map((e) => e.exerciseId);
    const wasLast = routineIndex + 1 >= exerciseIds.length;
    nextExerciseInRoutine(exerciseIds);
    if (wasLast) showToast('Routine complete!', 2400);
  }

  return (
    <div>
      {editingSession && (
        <div style={{ background: 'var(--color-dark)', borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-bg)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Editing past session
            </div>
            <button
              onClick={() => {
                doneEditingSession();
                navigate('/app/history');
              }}
              style={{ background: '#fff', border: 'none', color: 'var(--color-dark)', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '8px 14px', borderRadius: 8 }}
            >
              Done
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="date"
              value={toLocalDateStr(editingSession.startedAt)}
              onChange={handleEditingDateChange}
              style={{ flex: 1, padding: '10px 12px', border: 'none', borderRadius: 8, fontSize: 14 }}
            />
            <input
              type="time"
              value={toLocalTimeStr(editingSession.startedAt)}
              onChange={handleEditingTimeChange}
              style={{ flex: 1, padding: '10px 12px', border: 'none', borderRadius: 8, fontSize: 14 }}
            />
          </div>
        </div>
      )}

      {!editingSession && liveSession && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 16,
            padding: '14px 20px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
            <div style={{ fontSize: 14, fontWeight: 700 }}>Session in progress &middot; started {formatTime(liveSession.startedAt)}</div>
          </div>
          <button
            onClick={() => setShowEndWorkoutConfirm(true)}
            style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            End workout
          </button>
        </div>
      )}

      {activeRoutine && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {activeRoutine.name}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent)' }}>
              {Math.min(routineIndex + 1, activeRoutine.exercises.length)} of {activeRoutine.exercises.length}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
            {activeRoutine.exercises.map((rc, idx) => {
              const isCurrent = idx === routineIndex;
              const isDone = idx < routineIndex;
              return (
                <button
                  key={`${rc.exerciseId}-${idx}`}
                  onClick={() => jumpToRoutineIndex(idx, activeRoutine.exercises.map((e) => e.exerciseId))}
                  style={{
                    flexShrink: 0,
                    padding: '9px 14px',
                    borderRadius: 10,
                    border: 'none',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: isCurrent ? 'var(--color-accent)' : isDone ? 'var(--color-success-bg)' : 'var(--color-subtle-bg)',
                    color: isCurrent ? '#fff' : isDone ? 'var(--color-success)' : 'var(--color-muted)',
                  }}
                >
                  {rc.exerciseName}
                </button>
              );
            })}
          </div>

          {selectedExercise && (
            <button
              onClick={handleNextExercise}
              style={{
                width: '100%',
                marginTop: 12,
                padding: 14,
                background: 'var(--color-dark)',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {routineIndex + 1 >= activeRoutine.exercises.length ? 'Finish routine' : 'Next exercise'}
            </button>
          )}
        </div>
      )}

      {activeSessionId && !selectedExercise && (
        <SessionSummary
          entries={sessionEntries}
          loading={historyLoading}
          sessionId={activeSessionId}
          onSelectExercise={selectExercise}
          onChanged={refetchHistory}
        />
      )}

      {!selectedExercise && (
        <ExercisePicker
          personExercises={personExercises}
          catalog={catalog}
          routines={routines}
          loading={personExercisesLoading}
          onSelectExercise={selectExercise}
          onAddExercise={(term) => setAddExerciseName((term || '').trim())}
          onStartRoutine={handleStartRoutine}
          hasActiveRoutine={!!activeRoutine}
        />
      )}

      {selectedExercise && (
        <ExerciseDetail
          exercise={selectedExercise}
          personId={activePersonId}
          personCategories={personCategories}
          onPersonalizationChanged={refreshPersonalization}
          editingSessionId={editingSession?.id || null}
          liveSession={liveSession}
          refetchLiveSession={refetchLiveSession}
          onBack={backToPicker}
        />
      )}

      {addExerciseName !== null && (
        <AddEditExerciseModal
          exercise={null}
          personId={activePersonId}
          initialName={addExerciseName}
          onClose={() => setAddExerciseName(null)}
          onSaved={handleExerciseCreated}
        />
      )}

      {showEndWorkoutConfirm && (
        <EndWorkoutConfirmModal
          personId={activePersonId}
          onClose={() => setShowEndWorkoutConfirm(false)}
          onEnded={() => {
            setShowEndWorkoutConfirm(false);
            endRoutine();
            refetchLiveSession();
            showToast('Workout ended. Logging a set anytime starts a new one.');
          }}
        />
      )}
    </div>
  );
}
