import { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { useAuth } from './AuthContext';
import { loadAppState, saveAppState } from '../lib/appStatePersistence';

// Client-only navigation/draft state -- which exercise is selected, active routine progress,
// in-flight weight/reps draft, current tab, etc. The server owns everything else (logged sets,
// sessions, PRs).
//
// Every person gets their OWN independent slice under `byPerson[personId]`; `activePersonId` just
// selects which slice is live. Switching people is a single field change, so one person's
// in-progress state can never bleed into another's. The whole thing is persisted per account to
// IndexedDB and rehydrated on load, so an active routine (and the rest of a person's in-progress
// UI) survives a page reload.

const PERSON_DEFAULTS = {
  selectedExerciseId: null,
  activeRoutineId: null,
  routineIndex: 0,
  editingSession: null, // { id, startedAt, endedAt } -- the caller already has the full session
  // object in hand when entering edit mode (History's Edit button / the Past Session modal); kept
  // per person so switching away mid-edit and back resumes it.
  // null, not a number: "no history yet". Rendered as an em dash and logged as 0 -- see
  // utils/formulas.js#computePrefillDraft for why the old 45 lb default was wrong for every
  // exercise that isn't a barbell lift.
  weightDraft: null,
  repsDraft: 8,
  // The second measure for a duration-tracked exercise (a plank's seconds), sitting beside
  // repsDraft rather than reusing it. An exercise only ever uses one of the two, so one field
  // would have worked -- and would have left a field named `reps` holding seconds, which is how
  // the "(sec)" exercise-name hack this feature replaces went wrong in the first place.
  durationDraft: 30,
  // A running hold timer's start, as an epoch millisecond timestamp, or null. It lives here rather
  // than only in UIContext because this slice is persisted to localStorage SYNCHRONOUSLY -- so a
  // max hold survives swUpdate.js's silent post-deploy reload instead of being destroyed at 1:55.
  // Storing the START, not the elapsed count, is also what makes the timer immune to iOS
  // suspending interval callbacks while the screen is locked. See UIContext's ticker.
  holdStartedAt: null,
  // What the drafts above belong to, and where they came from. All of them are written
  // together by SET_DRAFT and must be read together -- see ExerciseDetail's `userOwnsDraft`.
  //
  // These exist because the drafts are per-PERSON state describing a per-EXERCISE value that the
  // person may also have typed by hand. This provider sits above the router (App.jsx), so the
  // drafts outlive ExerciseDetail's unmount when you step back to the picker, and the routine
  // strip swaps the exercise without unmounting it at all. Without a stamp, the previous
  // exercise's numbers stay on screen until the new exercise's summary resolves, and a background
  // refetch can overwrite a weight the person typed.
  draftExerciseId: null, // which exercise these describe; a mismatch reads as "not known yet"
  draftSetCount: 0, // displaySets.length when seeded; an INCREASE means a set was logged
  draftSource: 'prefill', // 'prefill' = computed, free to replace | 'user' = typed, protected
  exerciseSearch: '',
  lastTab: '/app/log', // kept in sync by AppShell as the route changes.
  trendsRangeWeeks: 12,
  trendsExerciseId: null,
  // Which series the two Trends metric switchers are plotting. Per person like everything else
  // here: one person drilling into total reps must not retarget someone else's chart.
  trendsWeeklyMetric: 'volume', // 'volume' | 'sets' | 'reps'
  trendsExerciseMetric: 'est1rm', // see EXERCISE_METRICS in components/trends/exerciseMetrics.js
  // How the PRs board is ordered. Per person like the metric switchers above -- one person
  // ranking by est. 1RM must not reorder someone else's board. Unlike the PRs *filter* (local
  // state, deliberately cleared on a person switch -- see useExerciseFilter), a sort is a
  // standing preference, so it persists and survives switching away and back.
  prsSort: 'recent', // see PR_SORTS in utils/prSort.js
};

const initialState = {
  activePersonId: null,
  byPerson: {}, // { [personId]: { ...PERSON_DEFAULTS } }
};

// Patch the active person's slice. A no-op if there's no active person yet.
function updateActive(state, patch) {
  const id = state.activePersonId;
  if (id == null) return state;
  const current = state.byPerson[id] || PERSON_DEFAULTS;
  return { ...state, byPerson: { ...state.byPerson, [id]: { ...current, ...patch } } };
}

// Exported (alongside initialState/PERSON_DEFAULTS) so the reducer's transitions can be unit
// tested directly without rendering a component tree.
export { initialState, PERSON_DEFAULTS };
export function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE': {
      // Replace wholesale from persisted (or empty) state -- also clears any in-memory slice left
      // over from a previously logged-in account on this device.
      const byPerson = action.byPerson ?? {};
      // On a fresh login (action.resetTab), every person starts back on Log rather than resuming
      // wherever they were last -- that "resume last screen" behavior is only correct for a
      // mid-session reload, which never sets resetTab.
      //
      // PERSON_DEFAULTS underlays every restored slice so a field added to it AFTER a slice was
      // persisted hydrates as its default instead of `undefined`. Without this, adding a field
      // here silently ships an undefined to every existing user until they touch the control that
      // sets it -- which is how the Trends weekly-metric switcher blanked the page on hover.
      // See docs/incidents/2026-08-08-trends-hover-blank-page.md.
      const finalByPerson = Object.fromEntries(
        Object.entries(byPerson).map(([id, slice]) => [
          id,
          { ...PERSON_DEFAULTS, ...slice, ...(action.resetTab ? { lastTab: '/app/log' } : {}) },
        ]),
      );
      return { activePersonId: action.activePersonId ?? null, byPerson: finalByPerson };
    }
    case 'RECONCILE_PEOPLE': {
      // Drop slices for people no longer in the account, and null out activePersonId if the active
      // person was removed (AppShell then auto-selects). Returns the same state ref when there's
      // nothing to change, so it's safe to run on every people-list update without looping.
      const valid = new Set(action.personIds.map(Number));
      const entries = Object.entries(state.byPerson);
      const kept = entries.filter(([id]) => valid.has(Number(id)));
      const activeOk = state.activePersonId == null || valid.has(Number(state.activePersonId));
      if (kept.length === entries.length && activeOk) return state;
      return {
        ...state,
        byPerson: Object.fromEntries(kept),
        activePersonId: activeOk ? state.activePersonId : null,
      };
    }
    case 'SELECT_PERSON': {
      if (action.personId === state.activePersonId) return state;
      const byPerson = state.byPerson[action.personId]
        ? state.byPerson
        : { ...state.byPerson, [action.personId]: { ...PERSON_DEFAULTS } };
      return { ...state, activePersonId: action.personId, byPerson };
    }
    case 'SELECT_EXERCISE':
      return updateActive(state, { selectedExerciseId: action.exerciseId, exerciseSearch: '' });
    case 'BACK_TO_PICKER':
      return updateActive(state, { selectedExerciseId: null });
    case 'SET_EXERCISE_SEARCH':
      return updateActive(state, { exerciseSearch: action.value });
    case 'SET_LAST_TAB':
      return updateActive(state, { lastTab: action.path });
    case 'SET_TRENDS_RANGE':
      return updateActive(state, { trendsRangeWeeks: action.weeks });
    case 'SELECT_TRENDS_EXERCISE':
      return updateActive(state, { trendsExerciseId: action.exerciseId });
    case 'SET_TRENDS_WEEKLY_METRIC':
      return updateActive(state, { trendsWeeklyMetric: action.metric });
    case 'SET_TRENDS_EXERCISE_METRIC':
      return updateActive(state, { trendsExerciseMetric: action.metric });
    case 'SET_PRS_SORT':
      return updateActive(state, { prsSort: action.sort });
    // One action for both numbers and the whole stamp, deliberately not two. Independent
    // weight/reps writes let a partial update stamp the new exercise while the OTHER field still
    // holds the previous exercise's value -- the same "this number isn't yours" bug this stamp
    // exists to prevent, just one field at a time. Writing all five together makes that
    // unrepresentable. Callers pass what is currently on screen for the field they aren't changing
    // (see ExerciseDetail's commitDraft).
    case 'SET_DRAFT':
      return updateActive(state, {
        weightDraft: action.weight,
        repsDraft: action.reps,
        durationDraft: action.durationSeconds,
        draftExerciseId: action.exerciseId,
        draftSetCount: action.setCount,
        draftSource: action.source,
      });
    // Separate from SET_DRAFT on purpose: starting or stopping a hold says nothing about who owns
    // the drafts, so it must not restamp draftSource/draftExerciseId. The value the timer produces
    // is committed through SET_DRAFT like any other typed number.
    case 'SET_HOLD_STARTED_AT':
      return updateActive(state, { holdStartedAt: action.startedAt });
    case 'START_ROUTINE':
      return updateActive(state, {
        activeRoutineId: action.routineId,
        routineIndex: 0,
        selectedExerciseId: action.exerciseIds[0] ?? null,
      });
    case 'JUMP_TO_ROUTINE_INDEX':
      return updateActive(state, {
        routineIndex: action.index,
        selectedExerciseId: action.exerciseIds[action.index] ?? null,
      });
    case 'NEXT_EXERCISE_IN_ROUTINE': {
      const active = state.byPerson[state.activePersonId] || PERSON_DEFAULTS;
      const next = active.routineIndex + 1;
      if (next < action.exerciseIds.length) {
        return updateActive(state, { routineIndex: next, selectedExerciseId: action.exerciseIds[next] });
      }
      return updateActive(state, { activeRoutineId: null, routineIndex: 0, selectedExerciseId: null });
    }
    case 'END_ROUTINE':
      return updateActive(state, { activeRoutineId: null, routineIndex: 0 });
    case 'START_EDITING_SESSION':
      return updateActive(state, { editingSession: action.session, selectedExerciseId: null });
    case 'UPDATE_EDITING_SESSION':
      return updateActive(state, { editingSession: action.session });
    case 'DONE_EDITING_SESSION':
      return updateActive(state, { editingSession: null, selectedExerciseId: null });
    default:
      return state;
  }
}

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const { status, account, people, freshLogin } = useAuth();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [hydrated, setHydrated] = useState(false);
  const accountId = account?.id ?? null;

  // Rehydrate this account's persisted per-person state once we know which account we're in.
  // First paint is gated on this completing (ProtectedRoute shows the AppShell skeleton) so a
  // restored routine/tab is there on the first render, never popped in a beat later.
  useEffect(() => {
    let cancelled = false;
    if (status !== 'authenticated') {
      setHydrated(true); // nothing to hydrate on login/public pages -- don't block them
      return undefined;
    }
    setHydrated(false);
    loadAppState(accountId).then((loaded) => {
      if (cancelled) return;
      dispatch({
        type: 'HYDRATE',
        activePersonId: loaded?.activePersonId ?? null,
        byPerson: loaded?.byPerson ?? {},
        resetTab: freshLogin,
      });
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
    // freshLogin deliberately excluded -- it's read once via closure at the moment `status` flips to
    // 'authenticated' (set synchronously alongside status in the same login()/confirmEmail() call), so
    // including it would needlessly re-run this effect (and flash the hydrate skeleton) whenever the
    // online-reconcile effect later resets `freshLogin` to falsy on the same authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, accountId]);

  // Prune slices for removed people (and recover a dangling activePersonId) whenever the people
  // list changes, and right after hydration.
  useEffect(() => {
    if (status === 'authenticated' && hydrated) {
      dispatch({ type: 'RECONCILE_PEOPLE', personIds: people.map((p) => p.id) });
    }
  }, [people, status, hydrated]);

  // Persist on every change once hydrated, so we never clobber the stored copy with the empty
  // initial state before hydration has run. Written IMMEDIATELY (no debounce) because a reload can
  // arrive at any point after an action -- a routine-position jump, a tab switch -- including one
  // the person never asked for (`swUpdate.js` force-reloads on navigation whenever a new build
  // exists, i.e. always just after a deploy).
  //
  // `saveAppState` is SYNCHRONOUS (see appStatePersistence.js). That is what makes "written
  // immediately" actually mean written: once this line returns, the snapshot is durable, so there
  // is no in-flight write for a teardown to interrupt and nothing to flush on `pagehide` -- an
  // unload handler cannot await, which is why the previous IndexedDB-backed version could not close
  // this race no matter where the write was fired from.
  useEffect(() => {
    if (status !== 'authenticated' || !hydrated) return;
    saveAppState(accountId, { activePersonId: state.activePersonId, byPerson: state.byPerson });
  }, [state, accountId, status, hydrated]);

  const actions = useMemo(
    () => ({
      selectPerson: (personId) => dispatch({ type: 'SELECT_PERSON', personId }),
      selectExercise: (exerciseId) => dispatch({ type: 'SELECT_EXERCISE', exerciseId }),
      backToPicker: () => dispatch({ type: 'BACK_TO_PICKER' }),
      setExerciseSearch: (value) => dispatch({ type: 'SET_EXERCISE_SEARCH', value }),
      setLastTab: (path) => dispatch({ type: 'SET_LAST_TAB', path }),
      setTrendsRange: (weeks) => dispatch({ type: 'SET_TRENDS_RANGE', weeks }),
      selectTrendsExercise: (exerciseId) => dispatch({ type: 'SELECT_TRENDS_EXERCISE', exerciseId }),
      setTrendsWeeklyMetric: (metric) => dispatch({ type: 'SET_TRENDS_WEEKLY_METRIC', metric }),
      setTrendsExerciseMetric: (metric) => dispatch({ type: 'SET_TRENDS_EXERCISE_METRIC', metric }),
      setPrsSort: (sort) => dispatch({ type: 'SET_PRS_SORT', sort }),
      setDraft: ({ exerciseId, weight, reps, durationSeconds, setCount, source }) =>
        dispatch({ type: 'SET_DRAFT', exerciseId, weight, reps, durationSeconds, setCount, source }),
      setHoldStartedAt: (startedAt) => dispatch({ type: 'SET_HOLD_STARTED_AT', startedAt }),
      startRoutine: (routineId, exerciseIds) => dispatch({ type: 'START_ROUTINE', routineId, exerciseIds }),
      jumpToRoutineIndex: (index, exerciseIds) => dispatch({ type: 'JUMP_TO_ROUTINE_INDEX', index, exerciseIds }),
      nextExerciseInRoutine: (exerciseIds) => dispatch({ type: 'NEXT_EXERCISE_IN_ROUTINE', exerciseIds }),
      endRoutine: () => dispatch({ type: 'END_ROUTINE' }),
      startEditingSession: (session) => dispatch({ type: 'START_EDITING_SESSION', session }),
      updateEditingSession: (session) => dispatch({ type: 'UPDATE_EDITING_SESSION', session }),
      doneEditingSession: () => dispatch({ type: 'DONE_EDITING_SESSION' }),
    }),
    [],
  );

  // Expose the ACTIVE person's slice flattened to the top level, so consumers read
  // `selectedExerciseId`, `weightDraft`, etc. exactly as before -- the byPerson model is an
  // internal implementation detail.
  const active = state.byPerson[state.activePersonId] || PERSON_DEFAULTS;
  const value = useMemo(
    () => ({ activePersonId: state.activePersonId, hydrated, ...active, ...actions }),
    [state.activePersonId, hydrated, active, actions],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
