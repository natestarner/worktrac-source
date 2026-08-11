import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useHistory } from '../../hooks/useHistory';
import { useDurableMutation } from '../../hooks/useDurableMutation';
import { queryKeys } from '../../api/queryKeys';
import { newId } from '../../utils/id';
import { getExerciseSummary } from '../../api/stats';
import { listSessionSets } from '../../api/sets';
import { listCustomFields, removeExercise } from '../../api/exercises';
import { getSessionExerciseNote } from '../../api/notes';
import {
  DELETE_SET_MUTATION_KEY,
  FAVORITE_MUTATION_KEY,
  isUnsyncedWrite,
} from '../../lib/queryClient';
import { cancelPendingLogSet } from '../../lib/offlineSetEdits';
import { comparableLb, computePrefillDraft, isPrSet } from '../../utils/formulas';
import { deriveExerciseSummaryFromHistory, mergeBestWithLocalSets } from '../../utils/exerciseSummaryFromHistory';
import { formatDateLabel, toLocalDateStr } from '../../utils/datetime';
import WeightRepsStepper from './WeightRepsStepper';
import CustomFieldEditorModal from '../shared/CustomFieldEditorModal';
import ConfigureExerciseModal from '../shared/ConfigureExerciseModal';
import EditSetModal from '../shared/EditSetModal';
import ExerciseNoteModal from '../shared/ExerciseNoteModal';
import Button from '../shared/Button';
import IconButton from '../shared/IconButton';
import { IconMore, IconNote, IconPencil, IconPin, IconStar, IconStarFilled, IconTrash } from '../shared/icons';
import Skeleton from '../shared/Skeleton';
import SetPillRow from '../shared/SetPillRow';
import { tagChipStyle } from '../shared/tagChipStyle';

export default function ExerciseDetail({
  exercise,
  personId,
  tags = [],
  onPersonalizationChanged,
  editingSessionId,
  liveSession,
  refetchLiveSession,
  onBack,
  // Optional: when provided, renders a "View full exercise history" link that hands off to History
  // filtered to this exercise (see LogTab.jsx / HistoryTab.jsx's deep-link seed). Deliberately a
  // prop, not a direct useNavigate() call here -- ExerciseDetail takes onBack as a prop rather
  // than navigating itself, and its test file renders with no MemoryRouter at all.
  onViewAllHistory,
}) {
  const { account, people } = useAuth();
  const activePersonName = people.length >= 2 ? people.find((p) => p.id === personId)?.name : null;
  const activePersonFirstName = activePersonName?.split(' ')[0];
  const { weightDraft, repsDraft, setWeightDraft, setRepsDraft } = useAppState();
  const { showCelebration, showToast, startRestTimer, openConfirm } = useUI();
  const queryClient = useQueryClient();

  const contextSessionId = editingSessionId || liveSession?.id || null;

  const [editingCustomField, setEditingCustomField] = useState(null);
  const [showConfigureModal, setShowConfigureModal] = useState(false);
  const [editingSet, setEditingSet] = useState(null);
  const [justAddedSetId, setJustAddedSetId] = useState(null);
  const [showSessionNoteModal, setShowSessionNoteModal] = useState(false);
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

  // Offline/lie-fi fallback for the "Last time"/"Best est. 1RM" card: reads the already-warmed
  // history cache (see offlineCacheWarm.js) instead of a network round trip. Unpaginated history
  // makes this the SAME answer the server would give, not an approximation -- see
  // exerciseSummaryFromHistory.js. `history` is the same cache the Log tab already reads for
  // this person, so this is never a new request.
  const { history, loading: historyLoading } = useHistory(personId);
  const derivedSummary = useMemo(
    // historyLoading gates this to avoid a false "No sets yet"/"No PR yet" flash from an empty
    // [] default before history's own first fetch has actually resolved (online or offline).
    () => (historyLoading ? null : deriveExerciseSummaryFromHistory(history, exercise.id, contextSessionId)),
    [history, historyLoading, exercise.id, contextSessionId],
  );

  // Prefer the derived value once the live query has definitively given up -- paused (hard
  // offline/manual pin, never even attempts) or errored (lie-fi: the fetch IS attempted since
  // navigator.onLine is true, but the backend is unreachable, so it fails and -- with this
  // client's default retry: 2 -- eventually settles into isError). Gating on isPaused alone
  // would miss lie-fi entirely, since TanStack Query only pauses a fetch when onlineManager
  // reports offline; it does not pause a fetch that's failing for a different reason.
  // Deliberately NOT falling back just because data is merely absent (isLoading, still
  // in-flight/retrying) -- a slow-but-eventually-successful request, or one hanging against a
  // down-but-not-yet-timed-out backend, should still show its normal loading state rather than
  // jump to a possibly-stale derived answer.
  //
  // Once stuck, derivedSummary is preferred OVER summaryQuery.data (not just used when data is
  // absent) -- contextSessionId collapses to the same `null` cache key both "before this person
  // has ever logged anything" and "after their live session just ended" (see the comment on
  // summaryQuery above), so a stale cached answer from the FIRST of those two moments can already
  // be sitting under this exact key by the time the second one needs it. `staleTime: 0` means that
  // stale value paints instantly and a background revalidation kicks off to correct it -- fine
  // online (the RefreshingPill covers the brief gap), but if that revalidation is the one that
  // gets stuck, the stale-but-present answer would otherwise stand forever. `history` doesn't have
  // this collapsed-key problem, so it's the more trustworthy source once the live query can't
  // confirm which of the two moments its cached data actually belongs to.
  const summary = summaryQuery.isPaused || summaryQuery.isError
    ? (derivedSummary ?? summaryQuery.data ?? null)
    : (summaryQuery.data ?? null);
  const sessionSets = sessionSetsQuery.data ?? [];
  const customFields = customFieldsQuery.data ?? [];
  // Prefix-matches the registered defaults in queryClient.js (SAVE_NOTE_MUTATION_KEY =
  // ['saveNote']), same as logSetMutationKey below -- so this component's own saveNoteMutation
  // state stays isolated per exercise (LogTab doesn't remount ExerciseDetail when a routine
  // advances between exercises), and useMutationState below can filter on the key alone instead
  // of re-checking personId/exerciseId by hand.
  const saveNoteMutationKey = ['saveNote', personId, exercise.id];

  // sessionExerciseNote fallback for the same collapsed-null-key gap documented above on
  // summaryQuery/derivedSummary and on pendingBeforeSession below: contextSessionId stays null
  // for this person's ENTIRE offline/lie-fi stretch, not just before their first set -- the
  // placeholder liveSession seeded in logSetMutation.onMutate is deliberately `{ id: null }` so
  // it can never leak into contextSessionId, and the real id only arrives once the
  // create-session round trip actually reaches the server. sessionNoteQuery doesn't even run
  // in that state (enabled: !!contextSessionId), so read the pending SAVE_NOTE mutation's own
  // variables straight from the shared MutationCache instead -- the same technique
  // pendingBeforeSession uses for sets. Only `mode: 'live'` mutations are relevant here; a
  // `mode: 'session'` note (editing a past session) always has a real, already-known
  // editingSessionId and so never hits this gap.
  const pendingLiveNote = useMutationState({
    filters: { mutationKey: saveNoteMutationKey },
    select: (mutation) => ({
      status: mutation.state.status,
      // Immutable, app-assigned (see outboxSequence.js) -- unlike submittedAt, never re-stamped
      // by a re-dispatch, so "pick the newest" stays correct across any number of reloads.
      enqueueSeq: mutation.state.variables?.enqueueSeq,
      errorStatus: mutation.state.error?.status,
      mode: mutation.state.variables?.mode,
      note: mutation.state.variables?.note,
    }),
  })
    .filter(
      (m) =>
        m.mode === 'live' &&
        m.status !== 'success' &&
        !(m.status === 'error' && m.errorStatus >= 400 && m.errorStatus < 500),
    )
    .sort((a, b) => (b.enqueueSeq ?? -1) - (a.enqueueSeq ?? -1))[0] ?? null;
  const sessionNote = contextSessionId
    ? sessionNoteQuery.data?.note || null
    : (pendingLiveNote?.note || '').trim()
      ? pendingLiveNote.note
      : null;
  // Skeleton only when there's truly nothing to show yet: no server data, no derivable history,
  // and the summary query hasn't settled (and isn't paused offline, which would never settle).
  const ready = (summary != null || !summaryQuery.isLoading || summaryQuery.isPaused) && !customFieldsQuery.isLoading;

  const refetchCustomFields = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.customFields(personId, exercise.id) });

  const saveNoteMutation = useDurableMutation({ mutationKey: saveNoteMutationKey });
  const favoriteMutation = useDurableMutation({ mutationKey: FAVORITE_MUTATION_KEY });

  // Save/clear a session note. Durable + optimistic: the note is written into cache immediately (so
  // it shows offline too) and the idempotent upsert queues and replays on reconnect. A live note that
  // materializes the session before any set is logged is handled server-side on replay (the returned
  // session id drives reconciliation -- see SAVE_NOTE onSettled).
  function handleSaveSessionNote(note) {
    const trimmed = (note || '').trim();
    // Only write optimistically into the query cache when a real session already keys the note.
    // Saving a note while contextSessionId is null (no session has synced yet -- true before the
    // first set of a brand-new workout, and for the rest of an offline/lie-fi stretch even after
    // one) must NOT cache under the null key -- a later, genuinely different session also starts
    // out keyed null, so a stale note there would wrongly bleed into it. `sessionNote` above
    // covers that gap in the meantime via pendingLiveNote; once the session id syncs, SAVE_NOTE's
    // onSettled reconciles the real cache entry from the mutation's returned session id.
    if (contextSessionId) {
      queryClient.setQueryData(
        queryKeys.sessionExerciseNote(contextSessionId, exercise.id),
        trimmed ? { sessionId: contextSessionId, exerciseId: exercise.id, note } : null,
      );
    }
    saveNoteMutation.mutate({
      mode: editingSessionId ? 'session' : 'live',
      personId,
      sessionId: editingSessionId || null,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      note,
    });
    showToast(trimmed ? 'Note saved' : 'Note cleared');
  }

  // Favorite / unfavorite. Durable + optimistic: flip isFavorite in the picker/catalog caches now so
  // the star responds instantly (offline included); the idempotent PUT/DELETE replays on reconnect.
  function handleToggleFavorite() {
    const next = !exercise.isFavorite;
    const patch = (list = []) => list.map((e) => (e.id === exercise.id ? { ...e, isFavorite: next } : e));
    queryClient.setQueryData(queryKeys.personExercises(personId), patch);
    queryClient.setQueryData(queryKeys.exercises(), patch);
    favoriteMutation.mutate({ personId, exerciseId: exercise.id, exerciseName: exercise.name, favorite: next });
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

  // Clears the just-added highlight once its animation has had time to finish, so it
  // plays once per set logged rather than lingering or replaying on unrelated re-renders.
  useEffect(() => {
    if (!justAddedSetId) return;
    const timer = setTimeout(() => setJustAddedSetId(null), 1200);
    return () => clearTimeout(timer);
  }, [justAddedSetId]);

  const weightStep = defaultUnit === 'kg' ? 2.5 : 5;
  // `weightDraft` is null until there's any history to prefill from (see computePrefillDraft).
  // Everything that has to produce a NUMBER -- stepping, and the logged value itself -- reads
  // this; only the on-screen value keeps the null so it can render as an em dash.
  const weightValue = weightDraft ?? 0;

  function decWeight() {
    setWeightDraft(Math.max(0, Math.round((weightValue - weightStep) * 2) / 2));
  }
  function incWeight() {
    setWeightDraft(Math.round((weightValue + weightStep) * 2) / 2);
  }
  function decReps() {
    setRepsDraft(Math.max(0, repsDraft - 1));
  }
  function incReps() {
    setRepsDraft(repsDraft + 1);
  }

  // Prefix-matches the registered defaults in queryClient.js (LOG_SET_MUTATION_KEY = ['logSet']),
  // so the mutationFn, retry policy, serial replay scope, and server-truth reconciliation (onSettled)
  // all come from there -- the same options a mutation RESTORED from the durable offline outbox
  // replays with. This component only supplies the observer-side callbacks (optimistic insert,
  // rollback, PR celebration), which are inherently interactive and don't apply to a silent replay.
  const logSetMutationKey = ['logSet', personId, exercise.id];

  const logSetMutation = useDurableMutation({
    mutationKey: logSetMutationKey,
    onMutate: async (vars) => {
      // Show the set instantly by writing an optimistic row into the session-keyed cache.
      // Only possible once a session exists to key the list on -- the very first set of a
      // brand-new workout has no session id yet, so it can't be written here; that case is
      // instead covered by pendingBeforeSession (derived below from the mutation cache via
      // useMutationState), which shows the entered weight/reps directly from the mutation's
      // variables until the real session materializes and this exercise's sessionSets query
      // picks up the confirmed row.
      //
      // The whole body is wrapped in try/finally so handleLogSet's tap-ack promise always
      // resolves -- including the no-session-yet early return, and even if cancelQueries/
      // setQueryData somehow throws -- so the Log Set button can never hang. This step has no
      // network dependency (cancelQueries/setQueryData are local cache operations), so it
      // resolves quickly regardless of connectivity, unlike the mutation's own settlement, which
      // TanStack's default networkMode:'online' can leave paused indefinitely while offline.
      try {
        if (!contextSessionId) {
          // Seed a provisional live session (id: null, so it can never leak into
          // contextSessionId/activeSessionId or any id-keyed query) so the banner/green
          // dot/End-workout button light up immediately -- whether this write is paused
          // offline, in flight, or retrying against a server that's down (a set logged
          // against an unreachable backend is just as "session started" as one that's
          // genuinely offline; neither should leave the user staring at no feedback until
          // a request that may never succeed finally settles). `?? prev` keeps the
          // EARLIEST start time across multiple sets logged before the session syncs and
          // never clobbers a real (or already-seeded) session. The real session (with the
          // correct startedAt) replaces this once it actually syncs, via the registered
          // liveSession invalidation; EndWorkoutConfirmModal already clears it the same way.
          queryClient.setQueryData(
            queryKeys.liveSession(personId),
            (prev) => prev ?? { id: null, startedAt: vars.clientLoggedAt },
          );
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
      // A genuine 4xx is the server's definitive answer (bad input, a rejected request) -- roll
      // the optimistic set back and say so; it's not coming back on its own. Anything else (5xx /
      // timeout / network failure, reached only once shouldRetryWrite's retries are exhausted) is
      // transient: the write stays queued, visible (see unsyncedLogSets below), and durable via
      // the outbox, so there's nothing to roll back and no alarming toast -- it syncs once the
      // server/connection recovers, exactly like a paused-offline write.
      const isClientError = error?.status >= 400 && error?.status < 500;
      if (!isClientError) return;
      if (context?.key && context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
      showToast(error.message || "Couldn't save that set", { tone: 'error' });
    },
    onSuccess: (result, variables) => {
      setJustAddedSetId(result.set.id);
      // Pull the (possibly just-created) live session so its id propagates to the green dot, banner,
      // and this screen's contextSessionId right away. Interactive-only: a replayed set has no
      // observer here, so the registered default's liveSession invalidation covers that case.
      if (!editingSessionId) refetchLiveSession?.();
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
    // No onSettled here -- reconciliation (invalidate sets/summary/liveSession/prs/history to server
    // truth) lives in the registered default so it ALSO runs when a queued write replays after a
    // reload, when this component's observer no longer exists.
  });

  // Every log-set mutation for this exercise that hasn't synced yet -- in flight, retrying,
  // paused offline, or terminal-errored against an unreachable server -- read from the shared
  // MutationCache via mutationKey rather than logSetMutation's own reactive state, since a single
  // hook instance only reflects the most recently dispatched call and can't be trusted across an
  // exercise switch (ExerciseDetail isn't remounted when a routine advances -- LogTab keys it on
  // personId only; mutationKey embeds exercise.id fresh each render, so a stale exercise's
  // mutation naturally won't match). Deliberately not filtered to `status: 'pending'` -- a write
  // whose retries are exhausted (server down/unreachable) settles into 'error' but must stay
  // exactly as visible and durable as a paused one; only a definitive 4xx (the server's real
  // answer, rolled back by onError above) is excluded here.
  const unsyncedLogSets = useMutationState({
    filters: { mutationKey: logSetMutationKey },
    select: (mutation) => ({
      tempId: mutation.state.variables?.tempId,
      status: mutation.state.status,
      isPaused: mutation.state.isPaused,
      failureCount: mutation.state.failureCount,
      errorStatus: mutation.state.error?.status,
      weight: mutation.state.variables?.weight,
      reps: mutation.state.variables?.reps,
      unit: mutation.state.variables?.unit,
      clientLoggedAt: mutation.state.variables?.clientLoggedAt,
    }),
  }).filter((m) => m.tempId && isUnsyncedWrite(m));

  // "Saving..." is reserved for a write's very first attempt while it's genuinely in flight.
  // Once it's paused (offline), already failed at least once and is retrying, or sitting in a
  // transient error (retries exhausted, server still down), it's exactly as durable and editable
  // as an already-synced set (see offlineSetEdits.js -- lookup is by tempId regardless of
  // status), so it gets Edit/Delete instead of an indefinite spinner over a request that may
  // never succeed.
  const editableTempIds = unsyncedLogSets
    .filter((m) => m.isPaused || m.status === 'error' || m.failureCount > 0)
    .map((m) => m.tempId);

  // Sets whose onMutate had nowhere to write an optimistic row yet (no session existed at
  // dispatch time -- the very first set of a brand-new workout). Once a session exists,
  // onMutate's own optimistic insert already puts a matching-tempId row directly into
  // sessionSets, so this naturally excludes it there (no double-counting).
  //
  // The weight/reps are already known the instant a set is logged -- they're sitting right in
  // the mutation's own variables -- so always show them for real rather than an opaque shimmer,
  // regardless of whether this write is paused offline, still in flight, or stuck retrying
  // against a down server: "still saving" next to a blank row reads as "the app doesn't know
  // what I entered," which isn't true, and a request that never confirms would otherwise leave a
  // skeleton showing indefinitely instead of the values the user actually entered.
  // Sorted by clientLoggedAt, not left in mutation-cache order. restoreOutbox (outboxPersistence.js)
  // now registers restored writes in a single enqueue-order pass on reload (see outboxSequence.js),
  // and editing a pending set (EditSetModal.jsx / offlineSetEdits.js's patchPendingLogSetDisplay) no
  // longer removes or re-dispatches the underlying create -- it only patches its displayed
  // variables and queues a genuinely separate EDIT_SET write -- so neither path reorders the cache
  // anymore. This sort is now purely defensive: the "Set N" labels below are position-based, so
  // it's kept as a belt-and-suspenders guarantee rather than relying on mutation-cache order being
  // chronological.
  const pendingBeforeSession = unsyncedLogSets
    .filter((m) => !sessionSets.some((real) => real.id === m.tempId))
    .map((m) => ({ id: m.tempId, optimistic: true, weight: m.weight, reps: m.reps, unit: m.unit, clientLoggedAt: m.clientLoggedAt }))
    .sort((a, b) => new Date(a.clientLoggedAt ?? 0) - new Date(b.clientLoggedAt ?? 0));

  // Prepended, not appended -- these are chronologically the earliest set(s) of the session
  // whenever they're non-empty, and [...displaySets].reverse() below shows most-recent-first.
  const displaySets = [...pendingBeforeSession, ...sessionSets];

  // The best that the rows below are actually measured against. `summary.best` -- server or
  // derived-from-history -- cannot see a set that hasn't synced, so on its own it freezes for a
  // person's entire offline/lie-fi stretch while displaySets keeps growing, putting the PR pill on
  // the wrong row (see mergeBestWithLocalSets). displaySets, not sessionSets: while offline
  // onMutate writes no optimistic sessionSets row at all (that branch needs a real
  // contextSessionId, which stays null the whole time), so pendingBeforeSession is the only source
  // for those rows.
  //
  // Applied in every connectivity mode rather than gated on isPaused/isError: folding is a max, so
  // online -- where summary.best already includes every synced set -- it's a no-op except in the
  // brief window before the post-write refetch lands, where it just makes the badge correct sooner
  // instead of flickering onto a tying row and back off.
  // Not memoized on purpose: displaySets is rebuilt every render, so a useMemo keyed on it would
  // never hit. The fold is O(sets logged for this exercise this session) -- a handful of rows.
  const effectiveBest = mergeBestWithLocalSets(summary?.best ?? null, displaySets);

  // Prefill weight/reps: the same set-index in the most recent prior session, else the last set
  // logged today, else blank. Re-runs whenever the summary or today's sets change.
  //
  // Declared HERE, below displaySets, rather than up with the other effects, because it has to
  // read `displaySets` and not `sessionSets` -- the same reason effectiveBest does. Offline,
  // `contextSessionId` stays null for the person's entire outage, so the sessionSets query never
  // runs and its data stays `[]` however many sets they log; `pendingBeforeSession` is the only
  // source for those rows. Reading sessionSets here would freeze the set-index walk at set 1 and
  // make the carry-forward invisible for exactly as long as the outage lasts.
  useEffect(() => {
    if (!summary) return;
    const draft = computePrefillDraft(summary.lastSession, displaySets, defaultUnit);
    setWeightDraft(draft.weight);
    setRepsDraft(draft.reps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, displaySets.length]);

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
    // Every field the replay needs is passed as serializable variables -- nothing captured from a
    // closure -- so a mutation restored from the durable outbox after an app close can re-run
    // identically. `mode`/`sessionId` tell the registered mutationFn which endpoint to hit.
    logSetMutation.mutate({
      mode: editingSessionId ? 'session' : 'live',
      personId,
      sessionId: editingSessionId || null,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      unit: defaultUnit,
      // A blank draft logs as 0 rather than blocking the tap: 0 is exactly right for a
      // first-ever bodyweight exercise, and refusing the tap would punish that case to protect
      // a weighted one where the em dash is already visibly not a number.
      weight: weightValue,
      reps: repsDraft,
      tempId,
      idempotencyKey: newId(),
      clientLoggedAt: new Date().toISOString(),
    });
    return ack;
  }

  const deleteSetMutation = useDurableMutation({ mutationKey: DELETE_SET_MUTATION_KEY });

  function handleDeleteSet(set) {
    // Optimistically remove the row so it disappears immediately (offline too). Guarded on
    // contextSessionId because a set logged before any session exists yet (pendingBeforeSession)
    // was never written into this cache in the first place -- nothing to strip there.
    if (contextSessionId) {
      queryClient.setQueryData(queryKeys.sessionSets(contextSessionId, exercise.id), (old = []) =>
        old.filter((s) => s.id !== set.id),
      );
    }
    if (set.optimistic) {
      // Not yet synced -- there's no server row to delete, only a still-pending create. Cancel it
      // outright rather than queuing a delete that would 404 (see offlineSetEdits.js).
      cancelPendingLogSet(queryClient, set.id);
      return;
    }
    // Durable mutation reconciles sets/PRs/History on sync and treats a replay 404 (already
    // deleted) as success. NOT awaited on the network -- awaiting would hang the confirm dialog
    // while the mutation is paused offline; the local cache removal above is synchronous, so the
    // dialog closes right away.
    deleteSetMutation.mutate({ setId: set.id, personId, sessionId: contextSessionId, exerciseId: exercise.id, exerciseName: exercise.name });
  }

  const lastLabel = summary?.lastSession ? formatDateLabel(toLocalDateStr(summary.lastSession.startedAt)) : '';
  // Both read effectiveBest, not summary.best -- the card and the pills must agree with each other
  // and with the rows on screen, in every connectivity mode.
  const bestText = effectiveBest ? `${effectiveBest.est1rm} ${effectiveBest.unit}  (${effectiveBest.weight}${effectiveBest.unit}×${effectiveBest.reps})` : 'No PR yet';

  const bestComparableLb = effectiveBest
    ? comparableLb(effectiveBest.weight, effectiveBest.reps, effectiveBest.unit)
    : null;

  return (
    <div>
      <div className="exercise-detail-grid">
        <div>
          {/* The arrow stays a text entity, like the stepper's +/-. It renders identically
              everywhere and inherits colour and weight, so it was never the emoji problem
              -- and it is part of this button's accessible name, which three e2e specs
              select by. */}
          <button onClick={onBack} className="pressable" style={backButtonStyle}>
            &larr; All exercises
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: exercise.tags?.length ? 'var(--space-2)' : 'var(--space-5)' }}>
            <div
              style={{
                minWidth: 0,
                flex: 1,
                fontSize: 'var(--text-2xl)',
                fontWeight: 'var(--weight-bold)',
                letterSpacing: 'var(--tracking-tight)',
                lineHeight: 'var(--leading-tight)',
              }}
            >
              {exercise.name}
            </div>
            {/* These three were a text glyph and two emoji at three different font sizes,
                each with a ~20px hit area. As IconButtons they share one 40px target and
                one stroke weight. The aria-labels are unchanged -- e2e selects the note
                button by "Edit note for this session". */}
            <IconButton
              onClick={handleToggleFavorite}
              label={exercise.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              icon={exercise.isFavorite ? IconStarFilled : IconStar}
              tone={exercise.isFavorite ? 'accent' : 'default'}
            />
            <IconButton
              onClick={() => setShowSessionNoteModal(true)}
              label={sessionNote ? 'Edit note for this session' : 'Add a note for this session'}
              icon={IconNote}
              tone={sessionNote ? 'accent' : 'default'}
            />
            <IconButton onClick={() => setShowConfigureModal(true)} label="Customize this exercise" icon={IconMore} />
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
            <button onClick={() => setShowConfigureModal(true)} className="pressable" style={pinnedNoteStyle}>
              <IconPin size={14} style={{ marginTop: 2, color: 'var(--color-faint)' }} />
              <span>{exercise.note}</span>
            </button>
          )}

          {sessionNote && (
            <button onClick={() => setShowSessionNoteModal(true)} className="pressable" style={sessionNoteStyle}>
              <IconNote size={14} style={{ marginTop: 2, color: 'var(--color-accent)' }} />
              <span>{sessionNote}</span>
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
              <div className="summary-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
                <Skeleton width={90} height={11} style={{ marginBottom: 8 }} />
                <Skeleton width={110} height={20} />
              </div>
              <div className="summary-card" style={{ background: 'var(--color-pr-bg)', border: '1px solid var(--color-pr-border)', borderRadius: 'var(--radius-lg)' }}>
                <Skeleton width={100} height={11} style={{ marginBottom: 8 }} />
                <Skeleton width={130} height={20} />
              </div>
            </div>
          )}

          {ready && (
            <div className="summary-cards-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div className="summary-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
                <div style={cardLabelStyle}>Last time &middot; {lastLabel}</div>
                {summary?.lastSession ? (
                  <SetPillRow sets={summary.lastSession.sets} style={{ marginTop: 2 }} />
                ) : (
                  <div className="summary-card-value" style={{ fontWeight: 'var(--weight-bold)' }}>No sets yet</div>
                )}
                {summary?.lastSession?.note && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--space-1)',
                      fontSize: 'var(--text-xs)',
                      fontStyle: 'italic',
                      color: 'var(--color-muted)',
                      marginTop: 'var(--space-1)',
                    }}
                  >
                    <IconNote size={12} style={{ marginTop: 2 }} />
                    <span>{summary.lastSession.note}</span>
                  </div>
                )}
              </div>
              <div className="summary-card" style={{ background: 'var(--color-pr-bg)', border: '1px solid var(--color-pr-border)', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ ...cardLabelStyle, color: 'var(--color-pr-text)' }}>Best &middot; Est. 1RM</div>
                <div className="summary-card-value" style={{ fontWeight: 700, color: 'var(--color-pr-text)' }}>{bestText}</div>
              </div>
            </div>
          )}

          {onViewAllHistory && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => onViewAllHistory(exercise.id, exercise.name)}
                aria-label={`View full exercise history for ${exercise.name}`}
                className="pressable"
                style={viewHistoryLinkStyle}
              >
                View full exercise history &rarr;
              </button>
            </div>
          )}

          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-5)',
              marginBottom: 'var(--space-4)',
            }}
          >
            <div className="stepper-pair">
              <WeightRepsStepper
                label={`Weight (${defaultUnit})`}
                // Null, not 0: "we have no history for this exercise" and "you are lifting
                // zero" are different claims, and only one of them is ours to make.
                // WeightRepsStepper renders a null value as an em dash.
                value={weightDraft}
                onDec={decWeight}
                onInc={incWeight}
                onChange={setWeightDraft}
              />
              <WeightRepsStepper label="Reps" value={repsDraft} onDec={decReps} onInc={incReps} onChange={setRepsDraft} />
            </div>
            {/* The screen's one primary action, and the only place size="lg" is used on
                this screen. That isn't just emphasis: at --text-xl/700 the white label
                clears the AA Large threshold, which is what lets this button keep the
                brand accent rather than the darker --color-accent-strong the smaller
                filled buttons need. It's also the easiest thing on the page to hit
                mid-set, which is the whole point. */}
            <Button onClick={handleLogSet} variant="primary" size="lg" fullWidth>
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
          {/* Not gated on `ready` -- displaySets (optimistic rows + sessionSets) is already
              fully available independent of summaryQuery/customFieldsQuery, so a slow/hanging
              past-sets/PR read must never hold back a set the user just logged. Only the summary
              cards above legitimately wait on `ready`. */}
          {displaySets.length > 0 && (
            <>
              <div className="log-sets-heading">This session</div>
              <div
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '0 var(--space-5)',
                }}
              >
                {[...displaySets].reverse().map((set, i) => {
                  // displaySets is oldest-first (confirmed sets from the API, oldest first,
                  // with any pre-session placeholder(s) prepended since they're chronologically
                  // earliest) so "Set N" always labels a set's true chronological position --
                  // reverse only the rendering, not the numbering, so the most recently logged
                  // set shows on top.
                  const setNumber = displaySets.length - i;
                  const isPR = isPrSet(set.weight, set.reps, set.unit, bestComparableLb);
                  return (
                    <div
                      key={set.id}
                      className={set.id === justAddedSetId ? 'set-row-new' : undefined}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: 56,
                        padding: 'var(--space-2) 0',
                        borderRadius: 'var(--radius-md)',
                        borderBottom: i < displaySets.length - 1 ? '1px solid var(--color-border)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', fontWeight: 'var(--weight-normal)', width: 44 }}>
                          Set {setNumber}
                        </div>
                        {/* Deliberately one text node. Styling the unit and the "x" down to
                            --color-muted would read better typographically, but it requires
                            splitting this into spans, and ~20 assertions in this component's
                            test file look the row up with getByText('135 lb x 8') -- which
                            concatenates only DIRECT text-node children -- and then navigate
                            to the row via .parentElement. Not worth destabilising the offline
                            set-handling and PR-badge coverage for a subtle refinement. */}
                        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
                          {set.weight} {set.unit || 'lb'} &times; {set.reps}
                        </div>
                        {isPR && (
                          // title/aria-label mirror SetPillRow's PR pill -- "PR" alone is
                          // ambiguous to a screen reader, and colour alone isn't accessible.
                          <span
                            title="Personal record"
                            aria-label="Personal record"
                            style={{
                              background: 'var(--color-success-bg)',
                              color: 'var(--color-success)',
                              fontSize: 'var(--text-2xs)',
                              fontWeight: 'var(--weight-bold)',
                              padding: 'var(--space-1) var(--space-2)',
                              borderRadius: 'var(--radius-full)',
                              letterSpacing: 'var(--tracking-label)',
                            }}
                          >
                            PR
                          </span>
                        )}
                      </div>
                      {set.optimistic && !editableTempIds.includes(set.id) ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--weight-normal)',
                            color: 'var(--color-muted)',
                          }}
                        >
                          <span className="saving-dot" />
                          Saving&hellip;
                        </div>
                      ) : (
                        // A paused-offline (or transient-erroring) set -- still just a pending create
                        // in the outbox, no server row yet -- is just as editable/deletable as a
                        // synced one -- see offlineSetEdits.js. Delete cancels the pending create
                        // outright rather than queuing a delete against a set id that doesn't exist yet.
                        //
                        // Icon buttons, not text links. As 13px text with padding: 0 these
                        // were ~16px tall and sat 14px apart -- Edit immediately beside a
                        // destructive Delete, which is a mis-tap waiting to happen with
                        // sweaty hands mid-set. Each now owns a 40px target.
                        // The labels stay exactly "Edit" and "Delete": ~40 e2e assertions
                        // select these by accessible name.
                        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                          <IconButton onClick={() => setEditingSet(set)} label="Edit" icon={IconPencil} tone="accent" />
                          <IconButton
                            onClick={() => openConfirm('Delete this set?', () => handleDeleteSet(set))}
                            label="Delete"
                            icon={IconTrash}
                            tone="danger"
                          />
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
          personId={personId}
          exerciseId={exercise.id}
          exerciseName={exercise.name}
          sessionId={contextSessionId}
          onClose={() => setEditingSet(null)}
          onSaved={() => setEditingSet(null)}
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

// --color-accent-text, not --color-accent, on every one of these: they are all small
// text, where the brand orange is 3.44:1 and fails AA. See the accent token comments
// in index.css.
const backButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  minHeight: 40,
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
  padding: '0 0 var(--space-3) 0',
};

const cardLabelStyle = {
  fontSize: 'var(--text-2xs)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-label)',
  marginBottom: 'var(--space-1)',
};

const viewHistoryLinkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  minHeight: 40,
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
  padding: '0 0 var(--space-2) 0',
};

// A standing per-person note (persists across every session for this exercise) -- neutral
// border so it reads as "always true", distinct from the session note's accent border
// below ("true today").
const pinnedNoteStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--space-2)',
  width: '100%',
  boxSizing: 'border-box',
  textAlign: 'left',
  background: 'var(--color-subtle-bg)',
  border: 'none',
  borderLeft: '3px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-3) var(--space-4)',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-muted)',
  cursor: 'pointer',
  marginBottom: 'var(--space-2)',
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
    minHeight: 32,
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--radius-full)',
    border: `1px solid ${value ? 'var(--color-border)' : 'var(--color-pr-border)'}`,
    background: value ? 'var(--color-bg)' : 'var(--color-pr-bg)',
    color: value ? 'var(--color-text)' : 'var(--color-pr-text)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--weight-semibold)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
