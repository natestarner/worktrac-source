import { useEffect, useRef, useState } from 'react';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { queryKeys } from '../../api/queryKeys';
import { newId } from '../../utils/id';
import { getExerciseSummary } from '../../api/stats';
import { listSessionSets, logLiveSet, logSetIntoSession, deleteSet } from '../../api/sets';
import { listCustomFields, favoriteExercise, unfavoriteExercise, removeExercise } from '../../api/exercises';
import { getSessionExerciseNote, saveLiveExerciseNote, saveSessionExerciseNote } from '../../api/notes';
import { comparableLb, computePrefillDraft, isPrSet } from '../../utils/formulas';
import { formatDateLabel, toLocalDateStr } from '../../utils/datetime';
import WeightRepsStepper from './WeightRepsStepper';
import NumericKeypad from '../shared/NumericKeypad';
import CustomFieldEditorModal from '../shared/CustomFieldEditorModal';
import ConfigureExerciseModal from '../shared/ConfigureExerciseModal';
import EditSetModal from '../shared/EditSetModal';
import ExerciseNoteModal from '../shared/ExerciseNoteModal';
import Button from '../shared/Button';
import Skeleton from '../shared/Skeleton';

export default function ExerciseDetail({
  exercise,
  personId,
  tags = [],
  onPersonalizationChanged,
  editingSessionId,
  liveSession,
  refetchLiveSession,
  onBack,
}) {
  const { account, people } = useAuth();
  const activePersonName = people.length >= 2 ? people.find((p) => p.id === personId)?.name : null;
  const activePersonFirstName = activePersonName?.split(' ')[0];
  const { weightDraft, repsDraft, setWeightDraft, setRepsDraft } = useAppState();
  const { showCelebration, showToast, startRestTimer, openConfirm } = useUI();
  const queryClient = useQueryClient();

  const contextSessionId = editingSessionId || liveSession?.id || null;

  const [keypadField, setKeypadField] = useState(null);
  const [editingCustomField, setEditingCustomField] = useState(null);
  const [showConfigureModal, setShowConfigureModal] = useState(false);
  const [editingSet, setEditingSet] = useState(null);
  const [justAddedSetId, setJustAddedSetId] = useState(null);
  const [showSessionNoteModal, setShowSessionNoteModal] = useState(false);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  // Resolvers for handleLogSet's tap-ack promise, keyed by tempId -- see logSetMutation's
  // onMutate below.
  const logAckResolvers = useRef(new Map());

  const defaultUnit = account?.defaultUnit || 'lb';

  // All four reads are keyed on personId (directly, or via the person-scoped session id), so
  // switching people can never surface the previous person's summary/sets/fields/note. Combined
  // with the key={personId} remount at the LogTab call site, both the fetched data AND the local
  // component state above are isolated per person.
  const summaryQuery = useQuery({
    queryKey: queryKeys.exerciseSummary(personId, exercise.id, contextSessionId),
    queryFn: () => getExerciseSummary(personId, exercise.id, contextSessionId || undefined),
    enabled: !!personId && !!exercise.id,
    // contextSessionId collapses to null both "before this person has ever logged anything" and
    // "after their live session just ended" -- two points in time with genuinely different
    // summaries sharing the same cache key. staleTime 0 means a remount always revalidates in the
    // background (the cached value still paints instantly; the RefreshingPill covers the gap)
    // instead of ever serving a same-key-but-stale answer here.
    staleTime: 0,
  });
  const sessionSetsQuery = useQuery({
    queryKey: queryKeys.sessionSets(contextSessionId, exercise.id),
    queryFn: () => listSessionSets(contextSessionId, exercise.id),
    enabled: !!contextSessionId && !!exercise.id,
  });
  const customFieldsQuery = useQuery({
    queryKey: queryKeys.customFields(personId, exercise.id),
    queryFn: () => listCustomFields(personId, exercise.id),
    enabled: !!personId && !!exercise.id,
  });
  const sessionNoteQuery = useQuery({
    queryKey: queryKeys.sessionExerciseNote(contextSessionId, exercise.id),
    queryFn: () => getSessionExerciseNote(contextSessionId, exercise.id),
    enabled: !!contextSessionId && !!exercise.id,
  });

  const summary = summaryQuery.data ?? null;
  const sessionSets = sessionSetsQuery.data ?? [];
  const customFields = customFieldsQuery.data ?? [];
  const sessionNote = sessionNoteQuery.data?.note || null;
  // Skeleton only on genuine first load (no cached data yet); a cached revisit paints instantly.
  const ready = !summaryQuery.isLoading && !customFieldsQuery.isLoading;

  const refetchSummary = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.exerciseSummary(personId, exercise.id, contextSessionId) });
  const refetchSessionSets = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.sessionSets(contextSessionId, exercise.id) });
  const refetchCustomFields = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.customFields(personId, exercise.id) });

  // Saving a note before any set is logged (contextSessionId is still null) must still
  // materialize the live session, exactly like handleLogSet does for the first set of a
  // workout -- see SessionExerciseNoteService.upsertLiveNote on the backend.
  async function handleSaveSessionNote(note) {
    const result = editingSessionId
      ? await saveSessionExerciseNote(editingSessionId, exercise.id, note)
      : await saveLiveExerciseNote(personId, { exerciseId: exercise.id, note });
    if (!editingSessionId) await refetchLiveSession();
    await queryClient.invalidateQueries({
      queryKey: queryKeys.sessionExerciseNote(contextSessionId, exercise.id),
    });
    // History shows this note inline next to the session's exercise entry -- keep it in sync.
    await queryClient.invalidateQueries({ queryKey: queryKeys.history(personId) });
    showToast(result.note ? 'Note saved' : 'Note cleared');
    await refetchSummary();
  }

  async function handleToggleFavorite() {
    // The star's own isFavorite comes from the parent's personExercises/catalog data, which
    // only updates once onPersonalizationChanged's refetches resolve -- that round trip can
    // take a moment, so pulse the star in the meantime rather than leaving the tap looking
    // like it did nothing.
    setIsTogglingFavorite(true);
    try {
      if (exercise.isFavorite) await unfavoriteExercise(personId, exercise.id);
      else await favoriteExercise(personId, exercise.id);
      if (onPersonalizationChanged) await onPersonalizationChanged();
    } finally {
      setIsTogglingFavorite(false);
    }
  }

  function handleRequestDelete() {
    setShowConfigureModal(false);
    openConfirm(
      `Delete "${exercise.name}"? Already-logged sets for it are kept, but it will disappear from your picker.`,
      async () => {
        await removeExercise(exercise.id);
        if (onPersonalizationChanged) await onPersonalizationChanged();
        onBack();
      },
    );
  }

  // Prefill weight/reps from the same set-index in the most recent prior session,
  // recomputed whenever the exercise, its summary, or how many sets are already logged
  // in this session changes -- matches the prototype's refreshDraft exactly.
  useEffect(() => {
    if (!summary) return;
    const draft = computePrefillDraft(summary.lastSession, sessionSets.length, defaultUnit);
    setWeightDraft(draft.weight);
    setRepsDraft(draft.reps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, sessionSets.length]);

  // Clears the just-added highlight once its animation has had time to finish, so it
  // plays once per set logged rather than lingering or replaying on unrelated re-renders.
  useEffect(() => {
    if (!justAddedSetId) return;
    const timer = setTimeout(() => setJustAddedSetId(null), 1200);
    return () => clearTimeout(timer);
  }, [justAddedSetId]);

  const weightStep = defaultUnit === 'kg' ? 2.5 : 5;

  function decWeight() {
    setWeightDraft(Math.max(0, Math.round((weightDraft - weightStep) * 2) / 2));
  }
  function incWeight() {
    setWeightDraft(Math.round((weightDraft + weightStep) * 2) / 2);
  }
  function decReps() {
    setRepsDraft(Math.max(0, repsDraft - 1));
  }
  function incReps() {
    setRepsDraft(repsDraft + 1);
  }

  const logSetMutationKey = ['logSet', personId, exercise.id];

  const logSetMutation = useMutation({
    mutationKey: logSetMutationKey,
    mutationFn: ({ weight, reps, idempotencyKey, clientLoggedAt }) =>
      editingSessionId
        ? logSetIntoSession(editingSessionId, { exerciseId: exercise.id, weight, reps, idempotencyKey, clientLoggedAt })
        : logLiveSet(personId, { exerciseId: exercise.id, weight, reps, idempotencyKey, clientLoggedAt }),
    // A client (4xx) error won't succeed on replay -- fail fast. Transient network/5xx errors get
    // a few backed-off retries. When fully offline, TanStack's default networkMode pauses the
    // mutation rather than failing it, so the optimistic set stays on screen and auto-resumes on
    // reconnect; the idempotency key makes that replay safe (no double-insert). The durable
    // across-app-close queue is the later offline phase.
    retry: (failureCount, error) => {
      if (error?.status >= 400 && error?.status < 500) return false;
      return failureCount < 3;
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    onMutate: async (vars) => {
      // Show the set instantly by writing an optimistic row into the session-keyed cache.
      // Only possible once a session exists to key the list on -- the very first set of a
      // brand-new workout has no session id yet, so it can't be written here; that case is
      // instead covered by pendingBeforeSession (derived below from the mutation cache via
      // useMutationState), which shows a skeleton placeholder until the real session
      // materializes and this exercise's sessionSets query picks up the confirmed row.
      //
      // The whole body is wrapped in try/finally so handleLogSet's tap-ack promise always
      // resolves -- including the no-session-yet early return, and even if cancelQueries/
      // setQueryData somehow throws -- so the Log Set button can never hang. This step has no
      // network dependency (cancelQueries/setQueryData are local cache operations), so it
      // resolves quickly regardless of connectivity, unlike the mutation's own settlement, which
      // TanStack's default networkMode:'online' can leave paused indefinitely while offline.
      try {
        if (!contextSessionId) {
          setJustAddedSetId(vars.tempId);
          return {};
        }
        const key = queryKeys.sessionSets(contextSessionId, exercise.id);
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData(key);
        const optimisticSet = { id: vars.tempId, weight: vars.weight, reps: vars.reps, unit: defaultUnit, optimistic: true };
        queryClient.setQueryData(key, (old = []) => [...old, optimisticSet]);
        setJustAddedSetId(vars.tempId);
        return { previous, key };
      } finally {
        const resolveAck = logAckResolvers.current.get(vars.tempId);
        if (resolveAck) {
          resolveAck();
          logAckResolvers.current.delete(vars.tempId);
        }
      }
    },
    onError: (error, vars, context) => {
      // Roll the optimistic set back and say so. (Reached only for a genuine failure -- an offline
      // write is paused, not errored, so its set stays put and replays later.)
      if (context?.key && context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
      const isClientError = error?.status >= 400 && error?.status < 500;
      showToast(
        isClientError
          ? error.message || "Couldn't save that set"
          : "Couldn't save that set -- check your connection and try again",
      );
    },
    onSuccess: (result, variables) => {
      setJustAddedSetId(result.set.id);
      // PR celebration is driven by the server's authoritative isPR/best, never a refetch race;
      // the weight/reps shown come from the exact values submitted (the mutation variables).
      if (result.isPR) {
        const isBodyweight = result.best.weight === 0;
        showCelebration({
          exerciseName: exercise.name,
          isBodyweight,
          setText: `${variables.weight} ${defaultUnit} × ${variables.reps}`,
          est1rmText: isBodyweight ? `${variables.reps} reps` : `${result.best.est1rm} ${defaultUnit}`,
        });
      }
    },
    onSettled: () => {
      refetchSummary();
      refetchSessionSets();
      if (!editingSessionId) refetchLiveSession();
      queryClient.invalidateQueries({ queryKey: queryKeys.prs(personId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.history(personId) });
    },
  });

  // Every log-set mutation for this exercise currently pending (in flight, retrying, or
  // paused offline) -- read from the shared MutationCache via mutationKey rather than
  // logSetMutation's own reactive state, since a single hook instance only reflects the most
  // recently dispatched call and can't be trusted across an exercise switch (ExerciseDetail
  // isn't remounted when a routine advances -- LogTab keys it on personId only; mutationKey
  // embeds exercise.id fresh each render, so a stale exercise's mutation naturally won't match).
  const pendingLogSets = useMutationState({
    filters: { mutationKey: logSetMutationKey, status: 'pending' },
    select: (mutation) => ({ tempId: mutation.state.variables?.tempId, isPaused: mutation.state.isPaused }),
  }).filter((m) => m.tempId);

  // isPaused is only true while genuinely offline -- an online retry's backoff delay does not
  // set it, so "Saving..." below still covers that case correctly.
  const pausedTempIds = pendingLogSets.filter((m) => m.isPaused).map((m) => m.tempId);

  // Sets whose onMutate had nowhere to write an optimistic row yet (no session existed at
  // dispatch time -- the very first set of a brand-new workout). Once a session exists,
  // onMutate's own optimistic insert already puts a matching-tempId row directly into
  // sessionSets, so this naturally excludes it there (no double-counting). Rendered as a
  // skeleton (see below), not literal numbers -- there's a brief window between this mutation
  // leaving 'pending' and the confirmed row actually landing in sessionSets via onSettled's
  // refetch, and a skeleton reads as "still loading" through that gap rather than "data
  // disappeared."
  const pendingBeforeSession = pendingLogSets
    .filter((m) => !sessionSets.some((real) => real.id === m.tempId))
    .map((m) => ({ id: m.tempId, optimistic: true, skeleton: true }));

  // Prepended, not appended -- these are chronologically the earliest set(s) of the session
  // whenever they're non-empty, and [...displaySets].reverse() below shows most-recent-first.
  const displaySets = [...pendingBeforeSession, ...sessionSets];

  function handleLogSet() {
    // Rest timer starts immediately for the "instant" feel; it's a live-only concept.
    if (!editingSessionId) startRestTimer(personId, 90);
    const tempId = `optimistic-${newId()}`;
    // Button's pending window ends as soon as the optimistic write lands (onMutate, above),
    // not once the server responds -- onMutate has no network dependency, so this resolves
    // quickly even while offline. The real request continues independently via .mutate();
    // its own progress is tracked per-row (Saving.../"Will sync..."), not by the button.
    const ack = new Promise((resolve) => {
      logAckResolvers.current.set(tempId, resolve);
    });
    logSetMutation.mutate({
      weight: weightDraft,
      reps: repsDraft,
      tempId,
      idempotencyKey: newId(),
      clientLoggedAt: new Date().toISOString(),
    });
    return ack;
  }

  const deleteSetMutation = useMutation({
    mutationFn: (setId) => deleteSet(setId),
    onSettled: () => {
      refetchSummary();
      refetchSessionSets();
      // Deleting a set can change what the best/PR is (e.g. removing the PR set itself) --
      // keep the PR board and History in sync, mirroring the log-set and edit-set mutations.
      queryClient.invalidateQueries({ queryKey: queryKeys.prs(personId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.history(personId) });
    },
  });

  function handleDeleteSet(setId) {
    // Returned (not fire-and-forget) so ConfirmDialog's runConfirm genuinely awaits the
    // request -- previously it closed the dialog on the next microtask instead of once the
    // delete actually finished, leaving no feedback while it was in flight.
    return deleteSetMutation.mutateAsync(setId);
  }

  const lastLabel = summary?.lastSession ? formatDateLabel(toLocalDateStr(summary.lastSession.startedAt)) : '';
  const lastSetsText = summary?.lastSession
    ? summary.lastSession.sets.map((s) => `${s.weight}${s.unit || 'lb'}×${s.reps}`).join('  ')
    : 'No sets yet';
  const bestText = summary?.best ? `${summary.best.est1rm} ${summary.best.unit}  (${summary.best.weight}${summary.best.unit}×${summary.best.reps})` : 'No PR yet';

  const bestComparableLb = summary?.best
    ? comparableLb(summary.best.weight, summary.best.reps, summary.best.unit)
    : null;

  return (
    <div>
      <div className="exercise-detail-grid">
        <div>
          <button onClick={onBack} style={backButtonStyle}>
            &larr; All exercises
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: exercise.tags?.length ? 6 : 18 }}>
            <div style={{ minWidth: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em' }}>{exercise.name}</div>
            <button
              onClick={handleToggleFavorite}
              disabled={isTogglingFavorite}
              aria-label={exercise.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              className={isTogglingFavorite ? 'favorite-star-pending' : undefined}
              style={{
                ...iconButtonStyle,
                fontSize: 20,
                color: exercise.isFavorite ? 'var(--color-accent)' : 'var(--color-faint)',
                cursor: isTogglingFavorite ? 'default' : 'pointer',
              }}
            >
              {exercise.isFavorite ? '★' : '☆'}
            </button>
            <button
              onClick={() => setShowSessionNoteModal(true)}
              aria-label={sessionNote ? 'Edit note for this session' : 'Add a note for this session'}
              title={sessionNote ? 'Edit note for this session' : 'Add a note for this session'}
              style={{ ...iconButtonStyle, fontSize: 19, color: sessionNote ? 'var(--color-accent)' : 'var(--color-faint)' }}
            >
              📝
            </button>
            <button
              onClick={() => setShowConfigureModal(true)}
              aria-label="Customize this exercise"
              title="Customize this exercise"
              style={{ ...iconButtonStyle, fontSize: 22, fontWeight: 700, color: 'var(--color-muted)' }}
            >
              &#8942;
            </button>
          </div>
          {exercise.tags?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
              {exercise.tags.map((tag) => (
                <span key={tag.id} style={tagChipStyle}>
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {exercise.note && (
            <button onClick={() => setShowConfigureModal(true)} style={pinnedNoteStyle}>
              <span style={{ marginRight: 6 }}>📌</span>
              {exercise.note}
            </button>
          )}

          {sessionNote && (
            <button onClick={() => setShowSessionNoteModal(true)} style={sessionNoteStyle}>
              <span style={{ marginRight: 6 }}>📝</span>
              {sessionNote}
            </button>
          )}

          {customFields.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {customFields.map((field) => {
                const value = field.value || '';
                return (
                  <button key={`custom-${field.id}`} onClick={() => setEditingCustomField(field)} style={setupPillStyle(value)}>
                    {value ? `${field.name}: ${value}` : `${field.name}: set`}
                  </button>
                );
              })}
            </div>
          )}

          {!ready && (
            <div className="summary-cards-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div className="summary-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16 }}>
                <Skeleton width={90} height={11} style={{ marginBottom: 8 }} />
                <Skeleton width={110} height={20} />
              </div>
              <div className="summary-card" style={{ background: 'var(--color-pr-bg)', border: '1px solid var(--color-pr-border)', borderRadius: 16 }}>
                <Skeleton width={100} height={11} style={{ marginBottom: 8 }} />
                <Skeleton width={130} height={20} />
              </div>
            </div>
          )}

          {ready && (
            <div className="summary-cards-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div className="summary-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16 }}>
                <div style={cardLabelStyle}>Last time &middot; {lastLabel}</div>
                <div className="summary-card-value" style={{ fontWeight: 700 }}>{lastSetsText}</div>
                {summary?.lastSession?.note && (
                  <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--color-muted)', marginTop: 4 }}>
                    <span style={{ marginRight: 4 }}>📝</span>
                    {summary.lastSession.note}
                  </div>
                )}
              </div>
              <div className="summary-card" style={{ background: 'var(--color-pr-bg)', border: '1px solid var(--color-pr-border)', borderRadius: 16 }}>
                <div style={{ ...cardLabelStyle, color: 'var(--color-pr-text)' }}>Best &middot; Est. 1RM</div>
                <div className="summary-card-value" style={{ fontWeight: 700, color: 'var(--color-pr-text)' }}>{bestText}</div>
              </div>
            </div>
          )}

          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <div className="stepper-pair">
              <WeightRepsStepper
                label={`Weight (${defaultUnit})`}
                value={weightDraft}
                onDec={decWeight}
                onInc={incWeight}
                onValueTap={() => setKeypadField('weight')}
              />
              <WeightRepsStepper label="Reps" value={repsDraft} onDec={decReps} onInc={incReps} onValueTap={() => setKeypadField('reps')} />
            </div>
            <Button
              onClick={handleLogSet}
              style={{
                width: '100%',
                padding: 16,
                background: 'var(--color-accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {activePersonFirstName ? `Log set for ${activePersonFirstName}` : 'Log set'}
              </span>
            </Button>
          </div>
        </div>

        <div className="log-sets-col">
          {ready && displaySets.length > 0 && (
            <>
              <div className="log-sets-heading">This session</div>
              <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '8px 20px' }}>
                {[...displaySets].reverse().map((set, i) => {
                  // displaySets is oldest-first (confirmed sets from the API, oldest first,
                  // with any pre-session placeholder(s) prepended since they're chronologically
                  // earliest) so "Set N" always labels a set's true chronological position --
                  // reverse only the rendering, not the numbering, so the most recently logged
                  // set shows on top.
                  const setNumber = displaySets.length - i;
                  const isPR = !set.skeleton && isPrSet(set.weight, set.reps, set.unit, bestComparableLb);
                  return (
                    <div
                      key={set.id}
                      className={set.id === justAddedSetId ? 'set-row-new' : undefined}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 0',
                        borderRadius: 10,
                        borderBottom: i < displaySets.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none',
                      }}
                    >
                      {set.skeleton ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Skeleton width={40} height={13} />
                          <Skeleton width={100} height={17} />
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ fontSize: 13, color: 'var(--color-muted)', fontWeight: 600, width: 44 }}>Set {setNumber}</div>
                          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>
                            {set.weight} {set.unit || 'lb'} &times; {set.reps}
                          </div>
                          {isPR && (
                            <span
                              style={{
                                background: 'var(--color-success-bg)',
                                color: 'var(--color-success)',
                                fontSize: 11,
                                fontWeight: 800,
                                padding: '3px 8px',
                                borderRadius: 999,
                                letterSpacing: '0.03em',
                              }}
                            >
                              PR
                            </span>
                          )}
                        </div>
                      )}
                      {set.optimistic ? (
                        pausedTempIds.includes(set.id) ? (
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-muted)' }}>
                            Will sync once you're back online
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--color-muted)' }}>
                            <span className="saving-dot" />
                            Saving&hellip;
                          </div>
                        )
                      ) : (
                        <div style={{ display: 'flex', gap: 14 }}>
                          <button onClick={() => setEditingSet(set)} style={editLinkStyle}>
                            Edit
                          </button>
                          <button onClick={() => openConfirm('Delete this set?', () => handleDeleteSet(set.id))} style={deleteLinkStyle}>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {keypadField && (
        <NumericKeypad
          label={keypadField === 'weight' ? `Weight (${defaultUnit})` : 'Reps'}
          initialValue={keypadField === 'weight' ? weightDraft : repsDraft}
          onCancel={() => setKeypadField(null)}
          onDone={(value) => {
            if (keypadField === 'weight') setWeightDraft(value);
            else setRepsDraft(value);
            setKeypadField(null);
          }}
        />
      )}

      {editingCustomField && (
        <CustomFieldEditorModal
          personId={personId}
          exerciseId={exercise.id}
          field={editingCustomField}
          onClose={() => setEditingCustomField(null)}
          onSaved={() => {
            setEditingCustomField(null);
            refetchCustomFields();
          }}
          onDeleted={() => {
            setEditingCustomField(null);
            refetchCustomFields();
          }}
        />
      )}

      {showConfigureModal && (
        <ConfigureExerciseModal
          exercise={exercise}
          personId={personId}
          exerciseId={exercise.id}
          allTags={tags}
          appliedTagNames={(exercise.tags || []).map((t) => t.name)}
          customFields={customFields}
          onClose={() => setShowConfigureModal(false)}
          onFieldsChanged={refetchCustomFields}
          onTagsChanged={onPersonalizationChanged || (() => {})}
          onExerciseChanged={onPersonalizationChanged || (() => {})}
          onRequestDelete={handleRequestDelete}
        />
      )}

      {editingSet && (
        <EditSetModal
          set={editingSet}
          onClose={() => setEditingSet(null)}
          onSaved={() => {
            setEditingSet(null);
            refetchSummary();
            refetchSessionSets();
            // An edited set can change a personal best -> keep the PR board and History in sync,
            // matching what the log/delete-set mutations already invalidate.
            queryClient.invalidateQueries({ queryKey: queryKeys.prs(personId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.history(personId) });
          }}
        />
      )}

      {showSessionNoteModal && (
        <ExerciseNoteModal
          title="Note for this session"
          subtitle="Just for today's workout -- shown again next time in your Last time card"
          initialNote={sessionNote || ''}
          onClose={() => setShowSessionNoteModal(false)}
          onSave={handleSaveSessionNote}
        />
      )}
    </div>
  );
}

const backButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent)',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '0 0 16px 0',
};

const cardLabelStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 4,
};

const editLinkStyle = { background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const deleteLinkStyle = { background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

const iconButtonStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  lineHeight: 1,
  cursor: 'pointer',
  flexShrink: 0,
};

const tagChipStyle = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 999,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-muted)',
  fontSize: 12,
  fontWeight: 700,
};

// A standing per-person note (persists across every session for this exercise) -- neutral
// border so it reads as "always true", distinct from the session note's accent border
// below ("true today").
const pinnedNoteStyle = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  textAlign: 'left',
  background: 'var(--color-subtle-bg)',
  border: 'none',
  borderLeft: '3px solid var(--color-border)',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 13,
  color: 'var(--color-muted)',
  cursor: 'pointer',
  marginBottom: 10,
};

// A note scoped to the current session -- accent border distinguishes it from the
// standing note above.
const sessionNoteStyle = {
  ...pinnedNoteStyle,
  borderLeft: '3px solid var(--color-accent)',
  color: 'var(--color-text)',
};

function setupPillStyle(value) {
  return {
    flexShrink: 0,
    padding: '5px 12px',
    borderRadius: 999,
    border: `1px solid ${value ? 'var(--color-border)' : 'var(--color-pr-border)'}`,
    background: value ? 'var(--color-bg)' : 'var(--color-pr-bg)',
    color: value ? 'var(--color-text)' : 'var(--color-pr-text)',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
