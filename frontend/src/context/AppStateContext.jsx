import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
  weightDraft: 45,
  repsDraft: 8,
  exerciseSearch: '',
  lastTab: '/app/log', // kept in sync by AppShell as the route changes.
  trendsRangeWeeks: 12,
  trendsExerciseId: null,
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
    case 'HYDRATE':
      // Replace wholesale from persisted (or empty) state -- also clears any in-memory slice left
      // over from a previously logged-in account on this device.
      return { activePersonId: action.activePersonId ?? null, byPerson: action.byPerson ?? {} };
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
    case 'SET_WEIGHT_DRAFT':
      return updateActive(state, { weightDraft: action.value });
    case 'SET_REPS_DRAFT':
      return updateActive(state, { repsDraft: action.value });
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
  const { status, account, people } = useAuth();
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
      });
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [status, accountId]);

  // Prune slices for removed people (and recover a dangling activePersonId) whenever the people
  // list changes, and right after hydration.
  useEffect(() => {
    if (status === 'authenticated' && hydrated) {
      dispatch({ type: 'RECONCILE_PEOPLE', personIds: people.map((p) => p.id) });
    }
  }, [people, status, hydrated]);

  // Persist on every change once hydrated, so we never clobber the stored copy with the empty
  // initial state before hydration has run. Written IMMEDIATELY (no debounce): a reload can happen
  // at any point after an action (a routine-position jump, a tab switch), and there is no reliable
  // way to flush a delayed/debounced write before that -- `visibilitychange`/`pagehide` handlers
  // cannot be counted on to complete an in-flight async IndexedDB write before the document tears
  // down (confirmed empirically: a debounced write plus a best-effort unload flush still lost data
  // under `page.reload()`). idb-keyval's `set()` is cheap and async; firing it on every dispatch
  // rather than deferring it is what actually closes the race, at the cost of more (still small)
  // writes on high-frequency changes like exercise-search keystrokes.
  const pendingRef = useRef(null);
  useEffect(() => {
    if (status !== 'authenticated' || !hydrated) return;
    const snapshot = { activePersonId: state.activePersonId, byPerson: state.byPerson };
    pendingRef.current = { accountId, snapshot };
    saveAppState(accountId, snapshot);
  }, [state, accountId, status, hydrated]);

  // Extra safety net for the rare case a write is still in flight right as the tab closes/hides --
  // re-fires the same (idempotent) write so the latest snapshot is retried.
  useEffect(() => {
    function flush() {
      if (pendingRef.current) saveAppState(pendingRef.current.accountId, pendingRef.current.snapshot);
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flush();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  const actions = useMemo(
    () => ({
      selectPerson: (personId) => dispatch({ type: 'SELECT_PERSON', personId }),
      selectExercise: (exerciseId) => dispatch({ type: 'SELECT_EXERCISE', exerciseId }),
      backToPicker: () => dispatch({ type: 'BACK_TO_PICKER' }),
      setExerciseSearch: (value) => dispatch({ type: 'SET_EXERCISE_SEARCH', value }),
      setLastTab: (path) => dispatch({ type: 'SET_LAST_TAB', path }),
      setTrendsRange: (weeks) => dispatch({ type: 'SET_TRENDS_RANGE', weeks }),
      selectTrendsExercise: (exerciseId) => dispatch({ type: 'SELECT_TRENDS_EXERCISE', exerciseId }),
      setWeightDraft: (value) => dispatch({ type: 'SET_WEIGHT_DRAFT', value }),
      setRepsDraft: (value) => dispatch({ type: 'SET_REPS_DRAFT', value }),
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
