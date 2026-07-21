import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';
import { useTags } from '../../hooks/useTags';
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

function routineBannerDismissKey(personId) {
  return `workout-tracker-routine-banner-dismissed-${personId}`;
}

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
  const { tags, refetch: refetchTags } = useTags();
  // The full catalog powers search and lets us resolve a search-selected exercise that isn't
  // in the person's list yet.
  const { exercises: catalog, refetch: refetchCatalog } = useExercises();
  const { routines, loading: routinesLoading } = useRoutines(activePersonId);
  const { session: liveSession, refetch: refetchLiveSession } = useLiveSession(activePersonId);
  const activeSessionId = editingSession?.id || liveSession?.id || null;
  const { history, loading: historyLoading, refetch: refetchHistory } = useHistory(activeSessionId ? activePersonId : null);
  const [showEndWorkoutConfirm, setShowEndWorkoutConfirm] = useState(false);
  const [addExerciseName, setAddExerciseName] = useState(null); // null = closed; string = create modal prefilled with this name
  const [routineBannerDismissed, setRoutineBannerDismissed] = useState(false);
  const routinePillRefs = useRef({});

  const activeRoutine = activeRoutineId ? routines.find((r) => r.id === activeRoutineId) : null;
  const selectedExercise = selectedExerciseId
    ? personExercises.find((e) => e.id === selectedExerciseId) || catalog.find((e) => e.id === selectedExerciseId) || null
    : null;
  const sessionEntries = activeSessionId ? history.find((s) => s.id === activeSessionId)?.entries ?? [] : [];

  useEffect(() => {
    if (activeSessionId && !selectedExerciseId) refetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, selectedExerciseId]);

  // Reconcile a persisted "in a routine" against reality: if the routine was deleted (on this or
  // another device) since it was last active, drop the stale routine state rather than showing an
  // empty routine banner.
  useEffect(() => {
    if (!routinesLoading && activeRoutineId && !routines.some((r) => r.id === activeRoutineId)) {
      endRoutine();
    }
  }, [routinesLoading, activeRoutineId, routines, endRoutine]);

  // Returning to the picker refreshes the person's list so a just-logged exercise (or a
  // favorite/tag change made on the detail screen) shows up.
  useEffect(() => {
    if (!selectedExerciseId) refetchPersonExercises();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExerciseId]);

  // The "create a routine" nudge banner's dismissal is a permanent-per-person preference,
  // not in-progress UI state, so it's kept in localStorage (not AppStateContext/UIContext)
  // and re-read whenever the active person changes.
  useEffect(() => {
    setRoutineBannerDismissed(localStorage.getItem(routineBannerDismissKey(activePersonId)) === 'true');
  }, [activePersonId]);

  function dismissRoutineBanner() {
    localStorage.setItem(routineBannerDismissKey(activePersonId), 'true');
    setRoutineBannerDismissed(true);
  }

  async function refreshPersonalization() {
    await Promise.all([refetchPersonExercises(), refetchTags(), refetchCatalog()]);
  }

  async function handleExerciseCreated(created) {
    setAddExerciseName(null);
    setExerciseSearch('');
    // Refresh both the person's picker list AND the shared catalog, so the new exercise also shows
    // up in search (the catalog has a long staleTime and won't refetch on its own for a while).
    await Promise.all([refetchPersonExercises(), refetchCatalog()]);
    if (created?.id) selectExercise(created.id);
  }

  async function handleEditingDateChange(e) {
    const iso = localDateTimeToIso(e.target.value, toLocalTimeStr(editingSession.startedAt));
    const updated = await editSession(editingSession.id, iso);
    updateEditingSession(updated);
    refetchHistory(); // keep the History tab's date/time for this session in sync
  }
  async function handleEditingTimeChange(e) {
    const iso = localDateTimeToIso(toLocalDateStr(editingSession.startedAt), e.target.value);
    const updated = await editSession(editingSession.id, iso);
    updateEditingSession(updated);
    refetchHistory();
  }

  function handleStartRoutine(routine) {
    startRoutine(routine.id, routine.exercises.map((e) => e.exerciseId));
  }

  // Keep the current exercise's pill visible in the horizontally-scrolling strip as the
  // routine advances -- with enough exercises in a routine, "Next exercise" would otherwise
  // move the current pill off-screen with nothing scrolling it back into view.
  useEffect(() => {
    const pill = routinePillRefs.current[routineIndex];
    // jsdom (unit tests) doesn't implement scrollIntoView -- guard rather than skip the effect
    // entirely so real browsers still get it.
    if (pill?.scrollIntoView) pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [routineIndex, activeRoutineId]);

  function handleNextExercise() {
    if (!activeRoutine) return;
    const exerciseIds = activeRoutine.exercises.map((e) => e.exerciseId);
    const wasLast = routineIndex + 1 >= exerciseIds.length;
    nextExerciseInRoutine(exerciseIds);
    if (wasLast) showToast('Routine complete!', 2400);
  }

  return (
    <div>
      {!routinesLoading && routines.length === 0 && !routineBannerDismissed && (
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
            gap: 12,
          }}
        >
          <div style={{ fontSize: 14 }}>
            For faster exercise logging,{' '}
            <span
              onClick={() => navigate('/app/routines')}
              style={{ color: 'var(--color-accent)', fontWeight: 700, cursor: 'pointer' }}
            >
              create a routine
            </span>
            .
          </div>
          <button
            onClick={dismissRoutineBanner}
            aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
          >
            &times;
          </button>
        </div>
      )}

      {editingSession && (
        <div style={{ background: 'var(--color-dark)', borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            {/* var(--color-accent-contrast) (always white) rather than var(--color-bg) -- the
                latter is meant as "page background", which is light in light mode but flips to
                near-black in dark mode, making this text unreadable against the always-dark
                chip background it sits on. */}
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent-contrast)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
              // 16px avoids iOS Safari's input-zoom -- see ExercisePicker.jsx's fontSize comment.
              style={{ flex: 1, padding: '10px 12px', border: 'none', borderRadius: 8, fontSize: 16 }}
            />
            <input
              type="time"
              value={toLocalTimeStr(editingSession.startedAt)}
              onChange={handleEditingTimeChange}
              style={{ flex: 1, padding: '10px 12px', border: 'none', borderRadius: 8, fontSize: 16 }}
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
                  ref={(el) => {
                    routinePillRefs.current[idx] = el;
                  }}
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
          // Remount on person switch so no local component state (keypad, editing-set, just-added
          // highlight) can bleed from one person to the next -- the per-person isolation guarantee.
          key={activePersonId}
          exercise={selectedExercise}
          personId={activePersonId}
          tags={tags}
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
            // Ending a workout from the exercise screen returns this person to their Log picker.
            backToPicker();
            refetchLiveSession();
            showToast('Workout ended. Logging a set anytime starts a new one.');
          }}
        />
      )}
    </div>
  );
}
