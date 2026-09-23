import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useHistory } from '../../hooks/useHistory';
import { useStepperIncrements } from '../../hooks/useStepperIncrements';
import { useDurableMutation } from '../../hooks/useDurableMutation';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { queryKeys } from '../../api/queryKeys';
import { isTempExerciseId } from '../../lib/exerciseIdMap';
import { newId } from '../../utils/id';
import { getExerciseSummary } from '../../api/stats';
import { listSessionSets } from '../../api/sets';
import { listCustomFields, removeExercise } from '../../api/exercises';
import { getSessionExerciseNote } from '../../api/notes';
import {
  DELETE_SET_MUTATION_KEY,
  FAVORITE_MUTATION_KEY,
  isDeleteQueuedFor,
  isUnsyncedWrite,
} from '../../lib/queryClient';
import { deleteQueuedSet } from '../../lib/offlineSetEdits';
import { comparableValue, computePrefillDraft, convertWeight, epley } from '../../utils/formulas';
import { isFirstEver, setPrTypes } from '../../utils/prDetection';
import {
  crossesSessionVolume,
  formatVolume,
  latchedVolume,
  mergeVolumeKinds,
  priorSessionVolume,
  sessionVolume,
  volumeKindOf,
} from '../../utils/sessionVolume';
import { buildHistoryPrFlags, liveSessionPrFlagKey } from '../../utils/historyPrFlags';
import { resolveRestTargetSeconds } from '../../utils/restTarget';
import {
  deriveExerciseSummaryFromHistory,
  mergeBestWithLocalSets,
  mergeHeaviestWithLocalSets,
} from '../../utils/exerciseSummaryFromHistory';
import { formatDateLabel, formatRestTime, MIN_HOLD_SECONDS, toLocalDateStr } from '../../utils/datetime';
import { formatSetSpaced, formatTarget } from '../../utils/formatSet';
import WeightRepsStepper from './WeightRepsStepper';
import DurationPickerSheet from '../shared/DurationPickerSheet';
import CustomFieldEditorModal from '../shared/CustomFieldEditorModal';
import ConfigureExerciseModal from '../shared/ConfigureExerciseModal';
import EditSetModal from '../shared/EditSetModal';
import ExerciseNoteModal from '../shared/ExerciseNoteModal';
import Button from '../shared/Button';
import IconButton from '../shared/IconButton';
import ReadOnlyWrap from '../shared/ReadOnlyWrap';
import { IconMore, IconNote, IconPencil, IconPin, IconStar, IconStarFilled, IconTrash, IconTrophy } from '../shared/icons';
import Skeleton from '../shared/Skeleton';
import SetPillRow from '../shared/SetPillRow';
import PrBadge, { est1rmLabelForSet, prBadgeLabel, prBadgeTitle } from '../shared/PrBadge';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

// How far from a record the nudge under the steppers is still worth showing. Past this it stops
// being encouragement and becomes a reminder of how far off you are -- and it would be on screen
// for every warm-up set of every exercise. See `prHint`.
const MAX_HINT_REPS = 3;
const MAX_HINT_SECONDS = 20;

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
  // The routine exercise being followed at this position, when a routine is running -- carrying
  // whatever the trainer prescribed. Null the rest of the time.
  prescribed = null,
}) {
  const { account, people } = useAuth();
  const activePersonName = people.length >= 2 ? people.find((p) => p.id === personId)?.name : null;
  const activePersonFirstName = activePersonName?.split(' ')[0];
  // Null whenever no routine is running, or the routine prescribes nothing at this position.
  const targetLabel = formatTarget(prescribed ?? {});
  const {
    weightDraft,
    repsDraft,
    durationDraft,
    holdStartedAt,
    draftExerciseId,
    draftSetCount,
    draftSource,
    setDraft,
    setHoldStartedAt,
    setRestTimer,
    // Per-person, per-exercise churn backstop for the session-volume celebration. See
    // PERSON_DEFAULTS.volumePrCelebrated -- the crossing test is the mechanism; this only stops a
    // re-fire if displaySets ever churns mid-drain.
    volumePrCelebrated,
    recordVolumePrCelebrated,
    clearVolumePrCelebrated,
  } = useAppState();
  // holdTimers is defaulted because it is read during RENDER: a context missing it would throw
  // mid-render, and a render-time throw has to be contained rather than allowed to white-screen the
  // log screen. The handlers below aren't defaulted -- they only run on a tap, where a missing one
  // should fail loudly rather than silently do nothing.
  const {
    showCelebration,
    showToast,
    startRestTimer,
    openConfirm,
    holdTimers = {},
    startHoldTimer,
    stopHoldTimer,
  } = useUI();
  const queryClient = useQueryClient();
  // The one Tier-3 write this screen owns (deleting the exercise itself). Everything else here is
  // durable and goes through the outbox; ConfigureExerciseModal has its own instance for the
  // rename/tags/fields it owns. See handleRequestDelete for why the gate has to wrap the CONFIRM
  // callback rather than the button.
  const deleteExercise = useGatedMutation({
    offlineMessage: 'Deleting needs a connection.',
    errorMessage: "Couldn't delete that exercise. Try again.",
  });

  // The one flag that decides what this screen measures. exercise.trackingType has shipped to the
  // client on both ExerciseDto and PersonExerciseDto since V6 -- it was simply never read.
  //
  // NOT a connectivity branch: this varies by exercise, not by network state, so it does not belong
  // on resilience.md's register of sanctioned divergences.
  const isDuration = exercise.trackingType === 'duration';

  const contextSessionId = editingSessionId || liveSession?.id || null;

  const [editingCustomField, setEditingCustomField] = useState(null);
  const [showConfigureModal, setShowConfigureModal] = useState(false);
  const [editingSet, setEditingSet] = useState(null);
  const [justAddedSetId, setJustAddedSetId] = useState(null);
  const [showSessionNoteModal, setShowSessionNoteModal] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
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
    // background (the cached value still paints instantly; the RefreshIndicator covers the gap)
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
    // liveSession?.startedAt is what lets the offline fallback exclude the CURRENT session from
    // bestSessionVolume without a session id -- onMutate seeds the provisional session with a
    // real startedAt even while its id is still null. See exerciseSummaryFromHistory.js.
    () =>
      historyLoading
        ? null
        : deriveExerciseSummaryFromHistory(history, exercise.id, contextSessionId, liveSession?.startedAt),
    [history, historyLoading, exercise.id, contextSessionId, liveSession?.startedAt],
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
  // online (the RefreshIndicator covers the brief gap), but if that revalidation is the one that
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

  // Tier-3, and already gated twice before it can be reached: ConfigureExerciseModal routes the
  // entry point through useGatedMutation with `disabled={!online}`, and the Customize button that
  // opens that modal is disabled for a temp id. Neither gate covers the window this handler owns,
  // though -- the actual write happens after the CONFIRM, and UIContext's runConfirm is
  // try/finally with no catch. So connectivity dropping between tapping Delete and confirming (or
  // any 500) rejected into nothing: the dialog closed and the exercise was still there, looking
  // exactly like a delete that worked.
  //
  // `deleteExercise.run` is the same useGatedMutation instance the rest of this screen's Tier-3
  // writes use, so the failure lands on the one error path rather than a try/catch hand-rolled
  // here -- open-coded copies of this with no catch are precisely what that hook was created to
  // remove (see .claude/rules/frontend-core.md). Nothing about the outbox is involved: an exercise
  // delete is not a durable write and never enters the queue.
  function handleRequestDelete() {
    setShowConfigureModal(false);
    openConfirm(
      `Delete "${exercise.name}"? Already-logged sets for it are kept, but it will disappear from your picker.`,
      deleteExercise.run(async () => {
        await removeExercise(exercise.id);
        if (onPersonalizationChanged) await onPersonalizationChanged();
        onBack();
      }),
    );
  }

  // Clears the just-added highlight once its animation has had time to finish, so it
  // plays once per set logged rather than lingering or replaying on unrelated re-renders.
  useEffect(() => {
    if (!justAddedSetId) return;
    const timer = setTimeout(() => setJustAddedSetId(null), 1200);
    return () => clearTimeout(timer);
  }, [justAddedSetId]);

  // Both step sizes are a per-person preference now (Settings -> Steppers), read off the /me people
  // list so they survive a cold offline boot in the auth snapshot. The old unit branch here
  // (kg ? 2.5 : 5) is gone: a step size is not a weight, so one number is right in either unit --
  // and the lb default moved to 2.5 to match kg, which is what removed the branch.
  const { weightIncrement: weightStep, durationIncrement: DURATION_STEP } = useStepperIncrements(personId);

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
        const optimisticSet = { id: vars.tempId, weight: vars.weight, reps: vars.reps, durationSeconds: vars.durationSeconds ?? null, unit: defaultUnit, optimistic: true };
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
    onSuccess: () => {
      // justAddedSetId is deliberately NOT re-stamped to the server id here. The row keeps its
      // tempId as its React key across the optimistic -> confirmed swap (see `rowKey` in the set
      // list below), so the stamp onMutate already set still matches and the 1.1s `set-row-new`
      // flash runs once to completion instead of restarting on a remounted row.
      //
      // The refetch below is kept, though the registered LOG_SET default now writes the real session straight from this
      // response (queryClient.js) so contextSessionId no longer WAITS on this round trip. It stays
      // because it is what drives the liveSession prop in this component's own test harness, and
      // because a revalidation against server truth after a write is right on its own terms. It is
      // now a background refetch over an already-correct value, not the thing the set list is
      // blocked on -- TanStack dedupes it against the default's invalidation of the same key.
      if (!editingSessionId) refetchLiveSession?.();
      // ⚠️ THE PR CELEBRATION IS NO LONGER RAISED HERE. It is decided at DISPATCH, in
      // handleLogSet, from bests the client already holds -- see prDetection.js.
      //
      // It used to read the server's `result.isPR` off this response, which meant it never fired
      // at all in three of the four connectivity modes: hard-offline the mutation never settles,
      // lie-fi it settles with `data === undefined`, and a write replayed from the outbox after a
      // reload has no component observer, so this callback does not run even once the set lands.
      // A record set in a gym basement was silently never celebrated.
      //
      // `result.isPR` still exists on the wire (LogSetResultDto) and is simply not consumed.
      // Do NOT re-add a celebration here as a "belt and braces" second path: two mechanisms
      // answering one question is the bug resilience.md's mechanism table exists to prevent, and
      // they would disagree on the same set (the server compares against its own best at insert
      // time, which for a queued write can be hours later).
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
      // Selected here or the row renders blank for a hold logged offline -- this projection is the
      // ONLY source of those rows while contextSessionId is null (the person's whole outage).
      durationSeconds: mutation.state.variables?.durationSeconds,
      unit: mutation.state.variables?.unit,
      clientLoggedAt: mutation.state.variables?.clientLoggedAt,
    }),
  })
    // A create deleted mid-save is still pending until it lands and the DELETE_SET queued behind it
    // runs (offlineSetEdits.js's deleteQueuedSet) -- the row is gone as far as the person is concerned.
    .filter((m) => m.tempId && isUnsyncedWrite(m) && !isDeleteQueuedFor(queryClient, m.tempId));

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
    // Matches the confirmed row by EITHER id: `real.id === tempId` is the pre-existing case (an
    // onMutate optimistic row, which carries the tempId as its id), and `real.tempId === tempId` is
    // the row LOG_SET's onSettled seeded straight from the response, which carries the server id
    // with the tempId alongside. Without the second, a pending row stayed in this list until the
    // mutation flipped to 'success' -- and setQueryData and that dispatch are separated by an await
    // inside TanStack's execute(), so notifyManager could flush a render between them and paint the
    // set twice. Note this predicate FAILS OPEN: an id that doesn't match anything leaves the
    // pending row rendering exactly as before, so it can never make a logged set disappear.
    .filter((m) => !sessionSets.some((real) => real.id === m.tempId || real.tempId === m.tempId))
    .map((m) => ({ id: m.tempId, optimistic: true, weight: m.weight, reps: m.reps, durationSeconds: m.durationSeconds ?? null, unit: m.unit, clientLoggedAt: m.clientLoggedAt }))
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
  const effectiveBest = mergeBestWithLocalSets(summary?.best ?? null, displaySets, liveSession?.startedAt);

  // The same fold, one measure over, for the top-weight record. Both bests have to see the sets
  // on screen that have not synced, or a PR logged offline goes uncelebrated and the NEXT, lighter
  // set gets celebrated against the frozen value instead -- the exact failure mergeBestWithLocalSets
  // was written for.
  const effectiveHeaviestLb = mergeHeaviestWithLocalSets(
    summary?.heaviestWeightLb == null ? null : Number(summary.heaviestWeightLb),
    displaySets,
  );

  // WHICH RECORDS EACH ROW BELOW TOOK -- the same derivation History uses, filtered to this
  // exercise so it is not a whole-history walk on the app's hottest screen.
  //
  // This replaced formulas.js#isPrSet, which asked a different question ("is this my best", a
  // +-0.5 TIE) and therefore gave a different answer: hitting your best three times pilled all
  // three rows here and badged one row on History. One idea must not have two answers depending
  // on the tab. It also only ever knew about est. 1RM, so a top-weight record went unmarked here
  // while History marked it.
  //
  // displaySets, not sessionSets: offline `onMutate` writes no optimistic sessionSets row at all,
  // so pendingBeforeSession is the only source for those rows -- the same reason effectiveBest
  // folds displaySets. That is what makes a record set with no signal badge immediately.
  //
  // Not memoized, for the same reason effectiveBest isn't: displaySets is rebuilt every render, so
  // a useMemo keyed on it would never hit.
  const prMarksForSession = buildHistoryPrFlags(history, {
    exerciseId: exercise.id,
    liveSession: { id: contextSessionId, startedAt: liveSession?.startedAt, entries: [{ exerciseId: exercise.id, sets: displaySets }] },
  }).setMarks.get(liveSessionPrFlagKey(contextSessionId, exercise.id)) || [];

  // What the DATA says this exercise should prefill to: the same set-index in the most recent
  // prior session, else the last set logged today, else blank. Computed during render, not in an
  // effect, so it can never be a frame behind the exercise on screen -- an effect runs after paint
  // at the earliest, which is what used to let the previous exercise's numbers show through.
  //
  // Reads `displaySets`, never `sessionSets`. Offline, `contextSessionId` stays null for the
  // person's entire outage, so the sessionSets query never runs and its data stays `[]` however
  // many sets they log; `pendingBeforeSession` is the only source for those rows. Reading
  // sessionSets here would freeze the set-index walk at set 1 and make the carry-forward invisible
  // for exactly as long as the outage lasts.
  const prefill = summary ? computePrefillDraft(summary.lastSession, displaySets, defaultUnit) : null;

  // A set was ADDED since the draft was seeded -- the carry-forward re-seed, and the only thing
  // allowed to replace a value the person typed.
  //
  // Strictly `>`, never `!==`. displaySets.length is transiently 0 while sessionSets reloads,
  // which happens on every remount -- and this component IS remounted whenever you step back to
  // the picker and reopen the exercise (LogTab renders it under `selectedExercise &&`). Keyed on
  // "the count changed", that transient reads as "a set was logged", hands ownership back to the
  // prefill, and lets the effect below permanently destroy a weight the person had typed before
  // stepping away. An increase can only mean a real addition. The cost is that deleting a set no
  // longer re-seeds; the draft is a suggestion, so that is the right side to err on.
  const setLoggedSinceSeed = displaySets.length > draftSetCount;

  // The person owns the value once they have typed or stepped it, and keeps owning it until they
  // log a set or leave for another exercise. Everything else that moves underneath -- a background
  // revalidation, the window-focus refetch that summaryQuery's staleTime: 0 guarantees, a pending
  // row reconciling into a real one -- must NOT re-seed over it.
  //
  // Without this, the re-seed could land after the person had typed a weight and before they tapped
  // Log set, and the set was silently logged at the prefill instead. Locally those queries return
  // in milliseconds so it almost never lost; against a deployed backend it did. See
  // docs/incidents/2026-08-12-prefill-overwrites-typed-weight.md.
  const userOwnsDraft =
    draftExerciseId === exercise.id && draftSource === 'user' && !setLoggedSinceSeed;

  // Paint the stored draft only while the person owns it; otherwise the freshly computed prefill,
  // and null (em dash) when even that isn't known yet. The draft lives in AppStateProvider ABOVE
  // the router, so it survives this component's unmount and still holds the PREVIOUS exercise's
  // numbers on a fresh mount -- painting those would assert "this is your history for this
  // exercise", which is false. Reps gets a null state for the same reason weight has one: an
  // honest blank beats another exercise's rep count.
  const shownWeight = userOwnsDraft ? weightDraft : (prefill?.weight ?? null);
  const shownReps = userOwnsDraft ? repsDraft : (prefill?.reps ?? null);
  const shownDuration = userOwnsDraft ? durationDraft : (prefill?.durationSeconds ?? null);

  // Everything that has to produce a NUMBER -- stepping, and the logged value itself -- reads
  // these; only the on-screen value keeps the null so it can render as an em dash. 8 is
  // computePrefillDraft's own no-history default, so a blank reps logs as the default rather than
  // blocking the tap, exactly as a blank weight logs as 0. 30 seconds is the same idea for a hold.
  const weightValue = shownWeight ?? 0;
  const repsValue = shownReps ?? 8;
  const durationValue = shownDuration ?? 30;

  // While a hold is running the stepper shows live elapsed time rather than the stored draft --
  // the number IS the timer. Stopping commits it through commitDraft like any typed value.
  const runningHoldElapsed = holdTimers[personId]?.elapsed ?? null;
  const holdRunning = isDuration && runningHoldElapsed !== null;
  const displayedDuration = holdRunning ? runningHoldElapsed : shownDuration;

  // Every user edit carries the whole on-screen state and claims ownership. `...patch` sits before
  // setCount/source so a caller can't accidentally override them.
  const commitDraft = (patch) =>
    setDraft({
      exerciseId: exercise.id,
      weight: shownWeight,
      reps: shownReps,
      durationSeconds: shownDuration,
      ...patch,
      setCount: displaySets.length,
      source: 'user',
    });

  function decWeight() {
    commitDraft({ weight: Math.max(0, Math.round((weightValue - weightStep) * 2) / 2) });
  }
  function incWeight() {
    commitDraft({ weight: Math.round((weightValue + weightStep) * 2) / 2 });
  }
  // The second stepper is Reps or Time depending on the exercise. Reps clamps at 0. Time steps in
  // 5s -- the granularity a hold is actually worth adjusting by -- and stepping off the bottom
  // CLEARS the field rather than parking on 0:01. Same rule as the picker: there is no 0-second
  // hold, so 0 means "no duration chosen" and renders as the em dash. Parking at the minimum
  // instead would leave 0:01 sitting there looking like a deliberate choice, and give the last
  // press of the - button nothing to do.
  function decSecond() {
    if (!isDuration) {
      commitDraft({ reps: Math.max(0, repsValue - 1) });
      return;
    }
    const next = durationValue - DURATION_STEP;
    commitDraft({ durationSeconds: next <= 0 ? null : next });
  }
  function incSecond() {
    if (isDuration) commitDraft({ durationSeconds: durationValue + DURATION_STEP });
    else commitDraft({ reps: repsValue + 1 });
  }
  function changeSecond(value) {
    if (!isDuration) {
      commitDraft({ reps: Math.max(0, Math.round(value)) });
      return;
    }
    // null is the picker's cleared state, and it is deliberately NOT clamped up to the minimum:
    // it means "no duration chosen", the same em-dash blank weight and reps already have. Blank
    // is a display state here, never a validation gate -- `durationValue` supplies the default at
    // log time exactly as `weightValue` and `repsValue` do for theirs.
    commitDraft({ durationSeconds: value == null ? null : Math.max(MIN_HOLD_SECONDS, Math.round(value)) });
  }

  // Start fills the field hands-free; Stop just writes the elapsed seconds into the draft. Stop
  // deliberately does NOT log: a mis-tap would otherwise commit a set, and "review, then tap Log
  // set" is what the primary button means on every other exercise. The timer is a nicer way to
  // type a number, nothing more.
  function handleToggleHold() {
    if (holdRunning) {
      const elapsed = stopHoldTimer(personId);
      setHoldStartedAt(null);
      if (elapsed !== null) commitDraft({ durationSeconds: elapsed });
      return;
    }
    const startedAt = Date.now();
    // Persisted synchronously (localStorage) so swUpdate's silent post-deploy reload resumes the
    // hold instead of destroying it mid-effort -- see AppStateContext's holdStartedAt.
    setHoldStartedAt(startedAt);
    // startHoldTimer already drops this person's IN-MEMORY rest timer (they have visibly stopped
    // resting, and two competing clocks on screen is nonsense). The persisted copy has to go in the
    // same step, or a reload mid-hold resurrects the rest timer that was just cleared.
    setRestTimer({});
    startHoldTimer(personId, startedAt);
  }

  // Resume a hold that was running when the document died. UIContext is in-memory, so only the
  // persisted timestamp survives; recomputing elapsed from it is also what makes the timer immune
  // to iOS suspending interval callbacks while the screen is locked.
  useEffect(() => {
    if (!isDuration || !holdStartedAt || holdTimers[personId]) return;
    startHoldTimer(personId, holdStartedAt);
    // Runs only to re-adopt a persisted hold; holdTimers is read, not tracked, to avoid re-adopting
    // the timer we just stopped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDuration, holdStartedAt, personId]);

  // Commits the computed prefill and claims the stamp for this exercise. Still needed alongside the
  // render-time derivation above: this is what re-seeds the carry-forward after a set is logged,
  // and what records that the value on screen is a prefill rather than the person's own.
  useEffect(() => {
    if (!prefill || userOwnsDraft) return;
    setDraft({
      exerciseId: exercise.id,
      weight: prefill.weight,
      reps: prefill.reps,
      durationSeconds: prefill.durationSeconds,
      setCount: displaySets.length,
      source: 'prefill',
    });
    // `prefill` is deliberately not a dep -- it's a fresh object every render, which would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id, summary, displaySets.length, userOwnsDraft]);

  function handleLogSet() {
    // A running hold is the value being logged -- take it rather than the stale draft, and clear
    // the timer so the next set starts from zero.
    let loggedDuration = durationValue;
    if (holdRunning) {
      const elapsed = stopHoldTimer(personId);
      if (elapsed !== null) loggedDuration = elapsed;
    }
    if (holdStartedAt) setHoldStartedAt(null);
    // Rest timer starts immediately for the "instant" feel; it's a live-only concept.
    //
    // The target is resolved ONCE, here, and snapshotted into the timer -- never re-derived from
    // whatever exercise happens to be selected later. Both values are also persisted synchronously
    // (localStorage) so the timer survives swUpdate's silent post-deploy reload, exactly as the hold
    // timer's start does; AppShell resumes from them on mount.
    if (!editingSessionId) {
      const restStartedAt = Date.now();
      const restTargetSeconds = resolveRestTargetSeconds({
        personExercise: exercise,
        person: people.find((p) => p.id === personId),
      });
      startRestTimer(personId, restTargetSeconds, restStartedAt);
      setRestTimer({ startedAt: restStartedAt, targetSeconds: restTargetSeconds });
    }
    // ## The PR celebration, decided HERE rather than from the server's response
    //
    // Everything below reads values the client already holds, so it runs identically online, under
    // lie-fi, hard-offline and pinned-offline. That is the whole point: this used to hang off the
    // log-set response, which never arrives in three of those four modes. One code path, no
    // useOnlineStatus, nothing that behaves differently by connectivity -- so it is not a branch
    // that belongs on resilience.md's register.
    //
    // It also cannot double-fire: a write replayed from the outbox has no component observer, so
    // this function is not reached again for a set already logged.
    // ⚠️ WRAPPED, AND THE WRAP IS THE POINT: a celebration must never be able to stop a set
    // being logged. Everything below is decoration over a write that has not been dispatched yet,
    // so any defect in it -- a measure spec this build does not know, a malformed restored
    // summary, a context missing its action -- would otherwise throw out of handleLogSet and lose
    // the set entirely. Losing a rep because the confetti broke is the worst possible trade, and
    // "show what's cached / queue and retry, never silently lost" is the whole contract.
    try {
      const loggedSet = {
        weight: weightValue,
        reps: isDuration ? 0 : repsValue,
        durationSeconds: isDuration ? Math.max(MIN_HOLD_SECONDS, loggedDuration) : null,
        unit: defaultUnit,
      };
      // effectiveBest / effectiveHeaviestLb are the bests BEFORE this set: displaySets has not grown
      // yet at this point in the tap.
      const priorBests = {
        comparable: effectiveBest ? comparableValue(effectiveBest) : null,
        heaviestLb: effectiveHeaviestLb,
      };
      const firstTime = isFirstEver(priorBests);
      const prTypes = setPrTypes(loggedSet, priorBests);

      // Session volume is the one celebrated measure that is not a property of this set, so it is
      // asked as a CROSSING: did the running total for this exercise pass the record with this set.
      // That is inherently once-per-session and needs no session id -- which matters, because
      // contextSessionId is null for a person's whole offline stretch.
      //
      // The measure (pounds, reps or seconds) is the exercise's over EVERYTHING known: the
      // summary's kind covers synced history, and today's sets -- this one included -- may not
      // have synced yet. One loaded set flips an all-bodyweight exercise to pounds, which is why
      // the kind is merged rather than read off either side alone. A never-logged exercise has no
      // prior at all, so its first workout never celebrates volume (sessionVolume.js).
      const todaysSets = [...displaySets, loggedSet];
      const volumeKind = mergeVolumeKinds(summary?.volumeKind ?? null, volumeKindOf(todaysSets));
      const volumeBefore = sessionVolume(displaySets, volumeKind);
      const volumeAfter = sessionVolume(todaysSets, volumeKind);
      const priorVolume = priorSessionVolume(summary, volumeKind);
      const alreadyCelebrated = latchedVolume(volumePrCelebrated?.[exercise.id], volumeKind);
      const volumePr =
        crossesSessionVolume(volumeBefore, volumeAfter, priorVolume) &&
        // The churn backstop, not the mechanism -- see PERSON_DEFAULTS.volumePrCelebrated.
        (alreadyCelebrated == null || volumeAfter > alreadyCelebrated);
      if (volumePr) {
        prTypes.push('sessionVolume');
        recordVolumePrCelebrated(exercise.id, { kind: volumeKind, value: volumeAfter });
      }

      if (prTypes.length > 0) {
        const setText = formatSetSpaced({
          weight: loggedSet.weight,
          reps: loggedSet.reps,
          durationSeconds: loggedSet.durationSeconds,
          unit: defaultUnit,
        });
        const isHold = loggedSet.durationSeconds != null;
        const loggedWeight = Number(loggedSet.weight) || 0;
        const rows = prTypes.map((type) => {
          if (type === 'heaviest') {
            return {
              type,
              valueText: `${loggedWeight} ${defaultUnit}`,
              // The value IS the weight, so repeating it would say nothing -- the reps are the
              // new information. Exactly the rule PRsTab's own "heaviest" branch follows, and it
              // also keeps this caption distinct from the est.-1RM row's when both fire at once.
              // On a hold reps are 0, so naming the record is the only honest caption there.
              caption: isHold ? 'Heaviest load held' : `× ${loggedSet.reps}`,
            };
          }
          if (type === 'sessionVolume') {
            return {
              type,
              valueText: formatVolume(volumeAfter, volumeKind, defaultUnit),
              caption: `${todaysSets.length} ${todaysSets.length === 1 ? 'set' : 'sets'} this workout`,
            };
          }
          // est1rm. ONE caption, chosen here rather than a boolean the overlay re-interprets.
          //
          // It was `isBodyweight: isBodyweight || isHold`, and PRCelebration rendered the literal
          // word "Bodyweight" for that flag -- so EVERY hold was captioned "Bodyweight", including
          // one logged with weight on it. The comment said a hold "takes the same rep-focused
          // presentation branch", which is true of the LAYOUT and false of the LABEL; one flag was
          // answering both questions. The caption does not repeat the word "hold": the badge above
          // already reads "Longest hold", so what is missing for a weighted hold is only the load.
          // The badge above now names the measure, so this no longer prefixes "Est. 1RM ·" --
          // that read twice in the same row. What is left is the set the estimate came from,
          // which is what the records table shows in parentheses after the number.
          const caption = isHold
            ? loggedWeight > 0
              ? `Weighted · ${loggedWeight} ${defaultUnit}`
              : 'Bodyweight'
            : loggedWeight === 0
              ? 'Bodyweight'
              : setText;
          return {
            type,
            // ⚠️ Not "Est. 1RM" in all three cases -- see est1rmLabelForSet. Shared with
            // History's badge so the same record cannot be named two different things on the two
            // screens it appears on.
            label: est1rmLabelForSet(loggedSet),
            // epley() now carries the 12-rep cap, so this is the same number the board will show.
            // No trailing "hold": the badge above already names it "Longest hold", and repeating
            // the word on the big number under it was the actual redundancy, not a second naming.
            valueText: isHold
              ? formatRestTime(loggedSet.durationSeconds)
              : loggedWeight === 0
                ? `${loggedSet.reps} reps`
                : `${epley(loggedWeight, loggedSet.reps)} ${defaultUnit}`,
            caption,
          };
        });
        showCelebration({ exerciseName: exercise.name, prs: rows, firstTime });
      }
    } catch {
      // Deliberately silent. There is nothing a person could do about it and nothing to retry;
      // the set below is logged either way, which is the part that matters.
    }

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
      // Exactly one measure, matching the exercise's tracking type -- a hold carries 0 reps
      // (it genuinely has none) and its seconds; a lift carries reps and no duration.
      reps: isDuration ? 0 : repsValue,
      // The last clamp before the wire, and it guards two things the controls can't: a hold
      // stopped the instant it started (0 elapsed), and a draft persisted by a build that
      // predates the floor. Sending 0 is a 400, and a definitive 4xx discards the queued write
      // for good rather than bouncing it back to be fixed.
      durationSeconds: isDuration ? Math.max(MIN_HOLD_SECONDS, loggedDuration) : null,
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
      // Not yet synced -- no confirmed server row, only a still-pending create. deleteQueuedSet
      // cancels it if it provably never left the device, and otherwise queues a real delete behind
      // it, since a create that may have reached the server cannot be un-sent (offlineSetEdits.js).
      deleteQueuedSet(queryClient, set.id, { personId, exerciseId: exercise.id, sessionId: contextSessionId });
      return;
    }
    // Durable mutation reconciles sets/PRs/History on sync and treats a replay 404 (already
    // deleted) as success. NOT awaited on the network -- awaiting would hang the confirm dialog
    // while the mutation is paused offline; the local cache removal above is synchronous, so the
    // dialog closes right away.
    deleteSetMutation.mutate({ setId: set.id, personId, sessionId: contextSessionId, exerciseId: exercise.id, exerciseName: exercise.name });
    // Re-arm the volume-celebration latch for this exercise. Editing a set down (or deleting one)
    // can LOWER the all-time session-volume record, and the latch holds the value last celebrated
    // -- left alone it would suppress every genuine new record below that old high-water mark, for
    // good, since it is persisted. See PERSON_DEFAULTS.volumePrCelebrated.
    clearVolumePrCelebrated(exercise.id);
  }

  const lastLabel = summary?.lastSession ? formatDateLabel(toLocalDateStr(summary.lastSession.startedAt)) : '';
  // Both read effectiveBest, not summary.best -- the card and the pills must agree with each other
  // and with the rows on screen, in every connectivity mode.
  //
  // A hold has no est. 1RM (BestDto sends null), so the card names the record it actually has:
  // the longest hold. Rendering "null lb" would be the "0 lb column" mistake bodyweightOnly
  // already avoids on the records table.
  const bestText = !effectiveBest
    ? 'No PR yet'
    : effectiveBest.durationSeconds != null
      ? formatSetSpaced(effectiveBest)
      : `${effectiveBest.est1rm} ${effectiveBest.unit}  (${effectiveBest.weight}${effectiveBest.unit}×${effectiveBest.reps})`;
  // No "Best" prefix -- the record-tinted card already reads as a best against the plain "Last
  // time" card beside it, and the word was pushing the date onto its own wrapped line on iPhone
  // portrait once a name like "Est. 1RM" and a date both had to fit ("Best · Est. 1RM · Sep 12").
  const bestCardLabel = isDuration ? 'Longest hold' : 'Est. 1RM';
  // The same pair `lastLabel` uses above -- toLocalDateStr first, because slicing a UTC ISO string
  // directly lands on the wrong day either side of midnight (see utils/datetime.js).
  const bestDateLabel = effectiveBest?.sessionStartedAt
    ? formatDateLabel(toLocalDateStr(effectiveBest.sessionStartedAt))
    : '';

  const bestComparable = effectiveBest ? comparableValue(effectiveBest) : null;

  // The nudge under the steppers: how much more the numbers ON SCREEN need before they take a
  // record, or -- once they already would -- that they already do.
  //
  // This is the highest-leverage thing on the screen because it is actionable at the moment of
  // action: it answers "is this set worth one more rep" before the set, not after it. It is
  // derived during render from effectiveBest -- which already folds in sets that have not synced
  // -- so it works in every connectivity mode by one code path, with no fetch behind it.
  //
  // ⚠️ IT NAMES THE RECORD, and the name is not always "Est. 1RM". This measures
  // comparableValue, which substitutes a rep count at weight 0 and seconds for a hold, so
  // est1rmLabelForSet supplies the right word for the draft on screen -- the same derivation the
  // badge on the row below and the celebration overlay use. .claude/rules/trends.md is explicit:
  // name all three cases, or name none. Unnamed, "1 more rep for a PR" was ambiguous against the
  // other record types the app now marks -- it never meant top weight or volume, and said so
  // nowhere.
  //
  // ⚠️ THE ARRIVED CASE IS THE WHOLE POINT OF THE FIRST BRANCH. The rep search below
  // starts at gap = 1 and never tested the CURRENT numbers, so once the draft already beat the
  // record it still reported "1 more rep for a PR" -- the count never reached zero, and no number
  // of extra reps ever made it say so. The duration branch always had this guard; the rep branch
  // did not.
  //
  // Bounded to REACHABLE gaps on purpose. "23 more reps for a PR" is not encouragement, it is a
  // reminder of how far off you are, and it would be on screen for every warm-up set of every
  // exercise. Silence is the right answer far more often than a number is.
  const prHint = (() => {
    if (bestComparable == null) return null; // nothing to beat yet
    // The draft as a set, so both the measure and its NAME come from the same place the row badge
    // and the celebration read.
    const draftSet = isDuration
      ? { weight: Number(weightValue) || 0, reps: 0, durationSeconds: durationValue, unit: defaultUnit }
      : { weight: Number(weightValue) || 0, reps: Number(repsValue) || 0, unit: defaultUnit };
    const recordName = est1rmLabelForSet(draftSet);
    // "a Est. 1RM PR" is wrong and "an Longest hold PR" is wrong; which one applies depends on the
    // record's name, which varies by set shape. Sounded from the first letter -- "Est." reads
    // "ess", so it takes "an".
    const article = /^[AEIOU]/.test(recordName) ? 'an' : 'a';
    const current = comparableValue(draftSet);
    if (Number.isFinite(current) && current > bestComparable) {
      return { arrived: true, text: `This would be ${article} ${recordName} PR` };
    }
    if (isDuration) {
      const seconds = durationValue;
      if (!Number.isFinite(seconds)) return null;
      const needed = Math.floor(bestComparable) + 1 - seconds;
      if (needed <= 0 || needed > MAX_HINT_SECONDS) return null;
      return { arrived: false, text: `${formatRestTime(needed)} longer for ${article} ${recordName} PR` };
    }
    const weight = draftSet.weight;
    const reps = draftSet.reps;
    // ⚠️ Searched forward through comparableValue rather than solved algebraically, and both
    // reasons are load-bearing:
    //
    //   1. THE REP CAP MAKES A CLOSED FORM WRONG. Past EST_1RM_REP_CAP the estimate stops rising,
    //      so for a heavy enough record NO number of reps at this weight can beat it -- and the
    //      algebra would cheerfully report one anyway ("4 more reps for a PR" that is not).
    //      Walking the actual function finds nothing and stays silent, which is the truth.
    //   2. FLOATING POINT. 30 * (180 / 135 - 1) is 9.999999999999998, not 10, so a floor() lands
    //      one rep short and the hint under-counts by exactly one at every round number.
    //
    // At most MAX_HINT_REPS iterations, and it is automatically correct at weight 0 (where the
    // comparable IS the rep count) and for any future change to the formula.
    for (let gap = 1; gap <= MAX_HINT_REPS; gap += 1) {
      const candidate = comparableValue({ weight, reps: reps + gap, unit: defaultUnit });
      if (candidate > bestComparable) {
        const noun = gap === 1 ? '1 more rep' : `${gap} more reps`;
        return { arrived: false, text: `${noun} for ${article} ${recordName} PR` };
      }
    }
    return null;
  })();

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
            {/* Favoriting writes to person_exercise, so it belongs to whoever's screen this is.
                ReadOnlyWrap nests INSIDE any offline wrapper by convention -- here there is none,
                because favoriting is a durable outbox write and works offline. */}
            <ReadOnlyWrap personId={personId}>
              <IconButton
                onClick={handleToggleFavorite}
                label={exercise.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                icon={exercise.isFavorite ? IconStarFilled : IconStar}
                tone={exercise.isFavorite ? 'accent' : 'default'}
              />
            </ReadOnlyWrap>
            <ReadOnlyWrap personId={personId}>
            <IconButton
              onClick={() => setShowSessionNoteModal(true)}
              label={sessionNote ? 'Edit note for this session' : 'Add a note for this session'}
              icon={IconNote}
              tone={sessionNote ? 'accent' : 'default'}
            />
            </ReadOnlyWrap>
            {/* Disabled until the exercise exists on the server. Everything behind this button is a
                Tier-3 write that posts the exercise id straight to `api/*` -- rename, tags, setup
                fields, delete -- and none of them resolve a temp id (unlike the durable writes,
                which go through requireResolvedExerciseId). Against `temp-exercise-<uuid>` the
                request 404s and the change silently does not happen: the field you just added
                simply never appears.
                Disabling the ENTRY POINT rather than locking the modal's controls is the same call
                OfflineDisabledWrap makes for the other Tier-3 entry points, and it is what
                AppShellSkeleton's disabled account control does for the same reason -- a disabled
                button fails Playwright's actionability check, so a click waits for the exercise to
                sync instead of firing at an id the server has never seen.
                Reachable online only since the create stopped waiting on a refetch before opening
                this screen (#186); offline it was always reachable, and always broken. */}
            {/* Everything inside the modal is a per-person write (standing note, tags, setup
                fields -- PersonExerciseController, personScoped), so on somebody else's screen all
                of it 403s. Its two neighbours above were wrapped and this was not, which left a
                live button between two greyed ones opening a modal where nothing could save.
                Disabled rather than hidden, unlike the rename controls inside: this one you CAN do,
                by switching to your own person. Nothing is lost by blocking the entry point --
                the tags and the standing note are both rendered inline just below. */}
            <ReadOnlyWrap personId={personId}>
              <IconButton
                onClick={() => setShowConfigureModal(true)}
                label="Customize this exercise"
                icon={IconMore}
                disabled={isTempExerciseId(exercise.id)}
                data-tour-anchor={TOUR_ANCHORS.CUSTOMIZE_EXERCISE}
              />
            </ReadOnlyWrap>
          </div>
          {exercise.tags?.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              {exercise.tags.map((tag) => (
                <span key={tag.id} className="tag-label">
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* Second entry point to the same modal -- wrapping only the "..." button would be
              cosmetic. */}
          {exercise.note && (
            <ReadOnlyWrap personId={personId}>
              <button onClick={() => setShowConfigureModal(true)} className="pressable" style={pinnedNoteStyle}>
                <IconPin size={14} style={{ marginTop: 2, color: 'var(--color-faint)' }} />
                <span>{exercise.note}</span>
              </button>
            </ReadOnlyWrap>
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
              <div className="summary-card" style={{ background: 'var(--color-record-bg)', border: '1px solid var(--color-record-border)', borderRadius: 'var(--radius-lg)' }}>
                {/* 110, not 90: this label carries a date ("Est. 1RM · Sep 12"), and a skeleton
                    narrower than the text it stands in for makes the card jump on load. */}
                <Skeleton width={110} height={11} style={{ marginBottom: 8 }} />
                <Skeleton width={130} height={20} />
              </div>
            </div>
          )}

          {/* ⚠️ A PRESCRIPTION, NEVER A LIMIT. Nothing validates a logged set against these
              numbers and nothing should: a client who lifts more than prescribed has had a good
              day, not made a mistake, and the app arguing with the gym floor is the one thing a
              logging-first product must not do. This renders the target and stops there -- it does
              not prefill the steppers, because a prefill the person did not type is exactly the
              race that logged a 315 deadlift as 0 (see docs/incidents/2026-08-12).

              Rendered above the summary cards rather than inside one: it is about the set ABOUT to
              be logged, while both cards below are about sets already logged. */}
          {targetLabel && (
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 'var(--space-1)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-muted)',
                marginBottom: 'var(--space-2)',
              }}
            >
              <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-accent-text)' }}>
                Target
              </span>
              <span>{targetLabel}</span>
            </div>
          )}

          {ready && (
            <div className="summary-cards-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div className="summary-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
                {/* The separator belongs to the date, not to the label: with no previous session
                    `lastLabel` is empty and a bare "Last time ·" left a middot dangling off the
                    end of the card -- in both themes, on the app's most-used screen. */}
                <div style={cardLabelStyle}>Last time{lastLabel && ` · ${lastLabel}`}</div>
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
              <div className="summary-card" style={{ background: 'var(--color-record-bg)', border: '1px solid var(--color-record-border)', borderRadius: 'var(--radius-lg)' }}>
                {/* The separator belongs to the date, for the same reason it does on the "Last
                    time" tile: a best merged from a set that predates this field (a query cache
                    written before it shipped) has no date, and a bare "Est. 1RM ·" leaves a
                    middot dangling off the end of the card. */}
                <div style={{ ...cardLabelStyle, color: 'var(--color-record-text)' }}>
                  {bestCardLabel}
                  {bestDateLabel && ` · ${bestDateLabel}`}
                </div>
                <div className="summary-card-value" style={{ fontWeight: 700, color: 'var(--color-record-text)' }}>{bestText}</div>
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
            <div className="stepper-pair" data-tour-anchor={TOUR_ANCHORS.SET_ENTRY}>
              <WeightRepsStepper
                label={`Weight (${defaultUnit})`}
                // Null, not 0: "we have no history for this exercise" and "you are lifting
                // zero" are different claims, and only one of them is ours to make.
                // WeightRepsStepper renders a null value as an em dash.
                value={shownWeight}
                onDec={decWeight}
                onInc={incWeight}
                // Clamped like the - button is. parseFloat happily returns -50 for a typed "-50",
                // and the backend answers a negative weight with a 400 -- which shouldRetryWrite
                // treats as terminal, so an offline-queued set would be DISCARDED rather than
                // corrected. Refusing the number here costs nothing; refusing it at the wire costs
                // the set.
                onChange={(weight) => commitDraft({ weight: Math.max(0, weight) })}
                atMin={weightValue <= 0}
              />
              {/* The second stepper is the whole feature: same control, same layout, only its
                  meaning changes with the exercise. A hold shows m:ss -- the same shape the timer
                  and every set row use, so a duration never changes format between entering it
                  and reading it back -- and tapping the value opens the min/sec wheel rather than
                  a keyboard that has no colon on it.

                  onPick is suppressed while a hold is running: the field is then a live readout of
                  the timer, and opening a picker onto a number that is moving underneath it has no
                  coherent answer for what happens when you let go. Stop, then adjust. */}
              <WeightRepsStepper
                label={isDuration ? 'Time' : 'Reps'}
                value={isDuration ? displayedDuration : shownReps}
                displayValue={isDuration && displayedDuration != null ? formatRestTime(displayedDuration) : undefined}
                onPick={isDuration && !holdRunning ? () => setShowDurationPicker(true) : undefined}
                onDec={decSecond}
                onInc={incSecond}
                onChange={changeSecond}
                // Reps dims at 0 because another - genuinely does nothing there. Time deliberately
                // does NOT: on this screen there is no value where - is inert -- from blank it
                // jumps to durationValue's ?? 30 default -- so dimming it would be a lie.
                atMin={!isDuration && repsValue <= 0}
                // ...but a HELD - on Time floors one step above blank and stops there. Stepping off
                // the bottom to blank stays reachable by a deliberate tap (that invariant is
                // load-bearing -- see .claude/rules/log-screen.md), while a finger held down can no
                // longer land on a blank field that then logs the 30s default. The two answers
                // differ here and only here, which is why floor is its own prop.
                holdFloor={isDuration ? durationValue <= DURATION_STEP : repsValue <= 0}
                // While a hold timer runs this field is a live readout of elapsed seconds, so it
                // changes on its own: neither of the hook's stop conditions could ever fire and a
                // held - would repeat indefinitely into a draft that Stop overwrites anyway. Same
                // reasoning as onPick's suppression above.
                repeatOnHold={!holdRunning}
              />
            </div>
            {/* Directly under the field it fills -- the timer is a hands-free way to enter a
                number, not a second way to log a set. Stopping writes the elapsed seconds into the
                draft and nothing else; "Log set" below stays the one primary action on every
                exercise, which is why this screen still has exactly one variant="primary".

                variant="dark", NOT secondary: this card is already --color-surface with a
                --color-border edge, and .btn-secondary is that exact pair -- so a secondary button
                here is surface-on-surface and reads as a label rather than a control. `dark` is a
                solid filled chip, unmistakably tappable and unmistakably not the accent action.
                size="lg" matches the Log set button's height so the two read as a stack of
                controls, and the wrapper's margin keeps them from touching. */}
            {isDuration && (
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <ReadOnlyWrap personId={personId}>
                <Button onClick={handleToggleHold} variant="dark" size="lg" fullWidth>
                  {holdRunning ? `Stop timer · ${formatRestTime(runningHoldElapsed)}` : 'Start timer'}
                </Button>
                </ReadOnlyWrap>
              </div>
            )}
            {/* The nudge, directly above the button it is about. Rendered only when it has
                something to say, so it costs no permanent space -- and it never moves the primary
                button under a thumb mid-set, because it appears while the person is adjusting the
                steppers, not while they are reaching for Log set. */}
            {prHint && (
              <div
                role="status"
                style={{
                  marginBottom: 'var(--space-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-1)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--color-record-text)',
                }}
              >
                {/* The glyph appears only once the draft HAS the record, so the line reads as the
                    same event the row below is about to show -- same icon, same tint. While still
                    counting down it stays text-only; a record glyph over a set you have not done
                    yet would be claiming something untrue. */}
                {prHint.arrived && <IconTrophy size={14} />}
                {prHint.text}
              </div>
            )}
            {/* The screen's one primary action, and the only place size="lg" is used on
                this screen. That isn't just emphasis: at --text-xl/700 the white label
                clears the AA Large threshold, which is what lets this button keep the
                brand accent rather than the darker --color-accent-strong the smaller
                filled buttons need. It's also the easiest thing on the page to hit
                mid-set, which is the whole point. */}
            {/* The screen's one primary action, and the one that matters most here: a member
                must never be able to log a set onto somebody else's history. */}
            <ReadOnlyWrap personId={personId}>
            <Button onClick={handleLogSet} variant="primary" size="lg" fullWidth data-tour-anchor={TOUR_ANCHORS.LOG_SET}>
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
            </ReadOnlyWrap>
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
                  // prMarksForSession is index-aligned to displaySets (oldest-first); this list is
                  // reversed for display only, so index back through the same arithmetic that
                  // produces setNumber rather than reversing the marks too.
                  const prTypes = prMarksForSession[setNumber - 1] || [];
                  // One identity for the row's whole life. A confirmed row seeded by LOG_SET's
                  // onSettled carries the tempId its optimistic predecessor was keyed on, so the
                  // temp -> real swap updates the row in place instead of unmounting it and
                  // replaying `set-row-new`. Used for the highlight test too, so the animation
                  // tracks the same row rather than restarting on a new one.
                  const rowKey = set.tempId ?? set.id;
                  return (
                    <div
                      key={rowKey}
                      className={rowKey === justAddedSetId ? 'set-row-new' : undefined}
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
                          {formatSetSpaced(set)}
                        </div>
                        {prTypes.length > 0 && (
                          // The same glyphs, the same tint and the same accessible name History's
                          // set pills use -- one PrBadge, so a top-weight record cannot look like
                          // one thing here and another there. This was a green "PR" text token,
                          // which made green mean "record" on two screens while the other three
                          // used the warm palette, and which never said WHICH record fell.
                          //
                          // The set is passed so an est.-1RM record on a pull-up reads "most reps"
                          // and on a plank "longest hold" -- see est1rmLabelForSet.
                          <span
                            title={prBadgeTitle(prTypes, set)}
                            aria-label={prBadgeLabel(prTypes, set)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
                          >
                            {prTypes.map((type) => (
                              <PrBadge key={type} type={type} size={14} />
                            ))}
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
                        // synced one -- see offlineSetEdits.js. Delete cancels the pending create if it
                        // never left the device, and otherwise queues a real delete behind it.
                        //
                        // Icon buttons, not text links. As 13px text with padding: 0 these
                        // were ~16px tall and sat 14px apart -- Edit immediately beside a
                        // destructive Delete, which is a mis-tap waiting to happen with
                        // sweaty hands mid-set. Each now owns a 40px target.
                        // The labels stay exactly "Edit" and "Delete": ~40 e2e assertions
                        // select these by accessible name.
                        // The labels stay exactly "Edit" and "Delete" -- ReadOnlyWrap clones the
                        // control in place and adds no DOM node, so the ~40 e2e assertions that
                        // select these by accessible name are unaffected.
                        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                          <ReadOnlyWrap personId={personId}>
                            <IconButton onClick={() => setEditingSet(set)} label="Edit" icon={IconPencil} tone="accent" />
                          </ReadOnlyWrap>
                          <ReadOnlyWrap personId={personId}>
                            <IconButton
                              onClick={() => openConfirm(
                                  'Delete this set? It stops counting toward your history, records and trends.',
                                  () => handleDeleteSet(set),
                                )}
                              label="Delete"
                              icon={IconTrash}
                              tone="danger"
                            />
                          </ReadOnlyWrap>
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
          onSaved={() => {
            setEditingSet(null);
            // Re-arm the volume-celebration latch: an edit can lower this exercise's all-time
            // session-volume record, and a latch left at the old value would suppress every
            // genuine new record below it, permanently. See PERSON_DEFAULTS.volumePrCelebrated.
            clearVolumePrCelebrated(exercise.id);
          }}
        />
      )}

      {showSessionNoteModal && (
        <ExerciseNoteModal
          title="Note for this session"
          subtitle="Just for today's workout — shown again next time in your Last time card"
          initialNote={sessionNote || ''}
          onClose={() => setShowSessionNoteModal(false)}
          onSave={handleSaveSessionNote}
        />
      )}

      {/* The sheet holds its own draft and only calls this on Done -- Cancel, the X and Escape
          all discard. What it does call is changeSecond, the same handler the +/- buttons use, so
          a picked value lands in the draft stamped source:'user' exactly as a typed one did: no
          second path into the draft, and no way for a background re-seed to stomp it. */}
      {showDurationPicker && (
        <DurationPickerSheet
          // shownDuration, not durationValue: a field already blank should open the wheel at 0:00
          // rather than at the 30s default, which would silently pre-answer the question.
          valueSeconds={shownDuration ?? 0}
          onChange={changeSecond}
          onClose={() => setShowDurationPicker(false)}
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
    border: `1px solid ${value ? 'var(--color-border)' : 'var(--color-highlight-border)'}`,
    background: value ? 'var(--color-bg)' : 'var(--color-highlight-bg)',
    color: value ? 'var(--color-text)' : 'var(--color-highlight-text)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--weight-semibold)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
