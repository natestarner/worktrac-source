import { useEffect, useRef, useState } from 'react';
import SectionLabel from '../shared/SectionLabel';
import { useNavigate } from 'react-router-dom';
import { queryClient, CREATE_EXERCISE_MUTATION_KEY } from '../../lib/queryClient';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';
import { useTags } from '../../hooks/useTags';
import { useRoutines } from '../../hooks/useRoutines';
import { useLiveSession } from '../../hooks/useLiveSession';
import { useHistory } from '../../hooks/useHistory';
import { useSessionEntries } from '../../hooks/useSessionEntries';
import { isTempExerciseId, resolveExerciseId } from '../../lib/exerciseIdMap';
import { editSession } from '../../api/sessions';
import { localDateTimeToIso, toLocalDateStr, toLocalTimeStr } from '../../utils/datetime';
import ExercisePicker from './ExercisePicker';
import ExerciseDetail from './ExerciseDetail';
import SessionSummary from './SessionSummary';
import AddEditExerciseModal from '../settings/AddEditExerciseModal';
import Button from '../shared/Button';
import IconButton from '../shared/IconButton';
import { IconClose } from '../shared/icons';

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
  const {
    routines,
    loading: routinesLoading,
    isFetching: routinesFetching,
    fetchedAfterMount: routinesFetchedAfterMount,
  } = useRoutines(activePersonId);
  const { session: liveSession, refetch: refetchLiveSession } = useLiveSession(activePersonId);
  const activeSessionId = editingSession?.id || liveSession?.id || null;
  // A provisional offline liveSession ({ id: null }, seeded in ExerciseDetail.jsx while genuinely
  // offline) has no server id to key history on, but it IS an active session -- the summary list
  // below must still show for it, sourced from pending mutations instead (see useSessionEntries).
  const hasActiveSession = !!editingSession || !!liveSession;
  const { history, loading: historyLoading, refetch: refetchHistory } = useHistory(activeSessionId ? activePersonId : null);
  const [addExerciseName, setAddExerciseName] = useState(null); // null = closed; string = create modal prefilled with this name
  const [routineBannerDismissed, setRoutineBannerDismissed] = useState(false);
  const routinePillRefs = useRef({});

  const activeRoutine = activeRoutineId ? routines.find((r) => r.id === activeRoutineId) : null;
  const selectedExercise = selectedExerciseId
    ? personExercises.find((e) => e.id === selectedExerciseId) || catalog.find((e) => e.id === selectedExerciseId) || null
    : null;
  const serverSessionEntries = activeSessionId ? history.find((s) => s.id === activeSessionId)?.entries ?? [] : [];
  const sessionEntries = useSessionEntries({ personId: activePersonId, serverEntries: serverSessionEntries, exercises: catalog });

  useEffect(() => {
    if (activeSessionId && !selectedExerciseId) refetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, selectedExerciseId]);

  // Reconcile a persisted "in a routine" against reality: if the routine was deleted (on this or
  // another device) since it was last active, drop the stale routine state rather than showing an
  // empty routine banner.
  //
  // Trustworthiness of `routines` for this DESTRUCTIVE decision cannot come from
  // `routinesLoading`/`isFetching` -- both read as "settled" (false) in states where `routines` is
  // NOT trustworthy: (a) right after a reload, before `activePersonId` itself has resolved, the
  // query is simply `enabled: false` -- neither loading nor fetching, `data` still `undefined` ->
  // `routines` defaults to `[]`, indistinguishable from "genuinely empty and settled"; (b) once
  // enabled, the query-cache persister is throttled (writes at most once/second, see
  // queryClient.js's `queryPersister`), so a reload shortly after creating a routine can restore a
  // STALE snapshot that predates it -- `isLoading` is already false because `data` isn't
  // `undefined`, it's just wrong.
  //
  // It cannot come from `dataUpdatedAt` either, which is what this gate used to read and is why it
  // is being replaced. That timestamp SURVIVES the persist/hydrate round trip, so a restored entry
  // reports itself freshly fetched -- the exact axis-D trap in
  // docs/incidents/2026-08-08-restored-cache-looks-fresh.md. The gate only ever held because
  // `routinesFetching` happened to already be true by the time this effect first ran: AppShell
  // (and with it useOfflineCacheWarming's boot warm) mounted a frame BEFORE LogTab, since
  // ProtectedRoute let <Outlet/> through early. That was an accident of render ordering, and
  // closing the empty-#root hole in that gate removed it -- at which point this effect ended a
  // live routine on every reload, from a restored list that predated it
  // (docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md).
  //
  // `isFetchedAfterMount` is the signal that actually answers the question: it counts fetches
  // completed since THIS observer mounted, so hydrated data reads false until the network confirms
  // it. It also fixes the same bug offline, where the old gate would fire on a restored list that
  // could not possibly be revalidated (a paused query reports `isFetching: false`). Not ending a
  // routine whose deletion we cannot confirm is the correct degradation; the next online mount
  // reconciles it. `!routinesFetching` still guards against acting on data about to be superseded.
  useEffect(() => {
    if (!routinesFetchedAfterMount || routinesFetching) return;
    if (activeRoutineId && !routines.some((r) => r.id === activeRoutineId)) {
      endRoutine();
    }
  }, [routinesFetchedAfterMount, routinesFetching, activeRoutineId, routines, endRoutine]);

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

  // When an exercise created offline finally syncs, its temp id is replaced by the real server id.
  // If the active person is still viewing that temp exercise, migrate the selection to the real id so
  // the screen seamlessly picks up the synced exercise (and its now server-backed sets) instead of
  // falling back to the picker when the temp row disappears from the refreshed catalog. Subscribes to
  // the app's singleton mutation cache (the outbox lives there), so no query-context dependency here.
  useEffect(() => {
    // Catch-up before subscribing: the subscription below only ever sees mappings recorded from
    // NOW on, and a create can sync while this component is unmounted -- another tab, or during
    // boot before this effect runs -- so a temp selection restored from persisted state may
    // already have a real id waiting in the map. Resolving here rather than in the
    // `selectedExercise` lookup above is deliberate: the map is a mutable module singleton that
    // triggers no re-render, so reading it during render would paint a stale answer.
    if (isTempExerciseId(selectedExerciseId)) {
      const resolved = resolveExerciseId(selectedExerciseId);
      if (resolved !== selectedExerciseId) selectExercise(resolved);
    }
    return queryClient.getMutationCache().subscribe((event) => {
      const mutation = event?.mutation;
      if (!mutation || mutation.options.mutationKey?.[0] !== CREATE_EXERCISE_MUTATION_KEY[0]) return;
      if (mutation.state.status !== 'success') return;
      const tempId = mutation.state.variables?.tempId;
      const realId = mutation.state.data?.id;
      if (tempId && realId && selectedExerciseId === tempId) {
        selectExercise(realId);
      }
    });
  }, [queryClient, selectedExerciseId, selectExercise]);

  // Select the new exercise SYNCHRONOUSLY, off the optimistic row the modal just wrote. There is
  // deliberately no refetch here, and re-adding one is the bug:
  //
  //   - It is redundant. insertOptimisticExercise (AddEditExerciseModal) has already written the
  //     new exercise into BOTH queryKeys.exercises() and queryKeys.personExercises(), so it is
  //     selectable and searchable immediately; and CREATE_EXERCISE's onSettled (queryClient.js)
  //     invalidates those same two keys once the server confirms -- the only moment a refetch can
  //     actually return the real row.
  //   - It is destructive. Awaiting an invalidation of the very keys holding the optimistic row
  //     evicts that row milliseconds before this line names it, so selectedExercise resolves to
  //     null and the person lands back on the picker. See the cache-warming table in
  //     .claude/rules/offline-internals.md ("refetching deletes it from the picker mid-flight") --
  //     same invariant, different call site -- and
  //     docs/incidents/2026-08-19-exercise-create-navigation-lost-online.md.
  //
  // Staying synchronous is also what makes this behave identically in every connectivity mode: the
  // await only ever resolved instantly while paused offline, which is why the bug was online-only
  // and why it hung for the full retry backoff under lie-fi.
  function handleExerciseCreated(created) {
    setAddExerciseName(null);
    setExerciseSearch('');
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

  // Bailing out of a routine partway through, as distinct from completing it via "Finish
  // routine". END_ROUTINE deliberately leaves `selectedExerciseId` alone (unlike stepping past
  // the last exercise, which returns to the picker), so this drops the routine chrome and leaves
  // the person exactly where they are -- free to keep logging the exercise they're on, off-script.
  //
  // No confirm dialog: this clears client-side navigation state only. Nothing logged is touched,
  // and the routine can be restarted from the picker's quick-start list. A modal here would cost
  // a tap on every deliberate use to guard an action with nothing to undo.
  function handleEndRoutine() {
    endRoutine();
    showToast('Routine ended.');
  }

  return (
    <div>
      {!routinesLoading && routines.length === 0 && !routineBannerDismissed && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-3) var(--space-5)',
            marginBottom: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ fontSize: 'var(--text-sm)' }}>
            For faster exercise logging,{' '}
            {/* Was a bare <span onClick>: not focusable, not keyboard-operable and
                announced as plain text. A real button with the link styling instead. */}
            <button
              onClick={() => navigate('/app/routines')}
              className="pressable"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                color: 'var(--color-accent-text)',
                fontWeight: 'var(--weight-semibold)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              create a routine
            </button>
            .
          </div>
          <IconButton onClick={dismissRoutineBanner} label="Dismiss" icon={IconClose} size={16} />
        </div>
      )}

      {editingSession && (
        <div style={{ background: 'var(--color-dark)', borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            {/* var(--color-accent-contrast) (always white) rather than var(--color-bg) -- the
                latter is meant as "page background", which is light in light mode but flips to
                near-black in dark mode, making this text unreadable against the always-dark
                chip background it sits on. */}
            <SectionLabel style={{ color: 'var(--color-accent-contrast)' }}>
              Editing past session
            </SectionLabel>
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

      {/* The "Session in progress" card used to render HERE, above everything else in the tab. It
          mounted the instant a set was logged (at onMutate, so in every connectivity mode) and cost
          ~66px in flow, shoving the primary "Log set" button down out from under the thumb that had
          just pressed it. It now lives in SessionBar -- fixed bottom chrome, mounted app-wide, which
          reserves its own space rather than displacing anything. The "Editing past session" card
          above stays in flow deliberately: that one is a form, not a status. */}

      {activeRoutine && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          {/* "End routine" lives up here, in the one piece of chrome that's on screen for the
              whole life of a routine (this card renders above BOTH the picker and the exercise
              screen). Before it, the only exit was "Finish routine" below -- which appears solely
              on the last step, and only while an exercise is open -- so leaving a routine early
              meant scrubbing the pill strip to its end and tapping in. Muted rather than the
              `ghost` variant's accent text: it sits beside the accent-coloured "n of m" counter,
              and two accent items in one row blur into each other. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: 12 }}>
            <SectionLabel>
              {activeRoutine.name}
            </SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent-text)' }}>
                {Math.min(routineIndex + 1, activeRoutine.exercises.length)} of {activeRoutine.exercises.length}
              </div>
              <Button variant="ghost" size="sm" onClick={handleEndRoutine} style={{ color: 'var(--color-muted)' }}>
                End routine
              </Button>
            </div>
          </div>
          {/* .hscroll, not an inline overflowX: this strip gets a deliberately thick, always-
              visible scrollbar so it can be scrubbed mid-workout. See index.css. */}
          <div className="hscroll" style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
                    borderRadius: 'var(--radius-md)',
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

          {/* Not gated on `selectedExercise`. That condition was carried over verbatim in #64 when
              this button moved up here out of ExerciseDetail (which only ever renders WITH an
              exercise open), so it was incidental rather than a decision -- and it meant backing
              out to the picker mid-routine hid the only way to advance. The label stays honest on
              both screens: from the picker, "Next exercise" advances a step and opens it. */}
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
        </div>
      )}

      {hasActiveSession && !selectedExercise && (
        <SessionSummary
          entries={sessionEntries}
          loading={activeSessionId ? historyLoading : false}
          sessionId={activeSessionId}
          // Load-bearing: the durable DELETE_SET write's reconcileSetChange invalidates
          // history/prs/summary/trends by personId. Without it those invalidations target
          // `undefined`, nothing refetches, and a removed exercise stays on screen forever even
          // though its sets were really deleted server-side.
          personId={activePersonId}
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
          // Deep-links into History pre-filtered to this exercise. fromLog:true is what tells
          // HistoryTab's filter bar to show a "Back to {exercise}" link -- selectedExerciseId is
          // untouched by this navigation, so returning via that link (or the Log tab itself)
          // lands back on this exact exercise screen.
          onViewAllHistory={(exerciseId, exerciseName) =>
            navigate('/app/history', { state: { historyExerciseFilter: { exerciseId, exerciseName, fromLog: true } } })
          }
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
    </div>
  );
}
