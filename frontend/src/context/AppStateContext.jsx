import { createContext, useCallback, useContext, useMemo, useReducer } from 'react';

// Mirrors the design prototype's client-only navigation/draft state: which exercise is
// selected, active routine progress, in-flight weight/reps draft, and a per-person
// snapshot cache so switching people and back resumes exactly where you left off (the
// server owns everything else -- logged sets, sessions, PRs, etc).

const initialState = {
  activePersonId: null,
  selectedExerciseId: null,
  activeRoutineId: null,
  routineIndex: 0,
  editingSession: null, // { id, startedAt, endedAt } -- kept locally since there's no
  // "get session by id" endpoint; the caller (History's Edit button, or the Past
  // Session modal) already has the full session object in hand when entering edit mode.
  // Snapshotted per person like everything else below, so switching away mid-edit and
  // back resumes the same in-progress past-session edit rather than dropping it.
  weightDraft: 45,
  repsDraft: 8,
  exerciseSearch: '', // also snapshotted per person -- a half-typed search on the
  // exercise picker survives switching away and back too.
  lastTab: '/app/log', // which of the Log/History/PRs/Routines/Trends/Admin tabs this
  // person was last viewing -- kept in sync by AppShell as the route changes, so switching
  // people and back resumes on the same tab too, not just the same in-progress state.
  trendsRangeWeeks: 12, // the Trends tab's selected time-range toggle (4/12/all-time).
  trendsExerciseId: null, // the exercise selected in the Trends tab's per-exercise drill-down.
  personSnapshots: {},
};

function snapshotOf(state) {
  return {
    selectedExerciseId: state.selectedExerciseId,
    activeRoutineId: state.activeRoutineId,
    routineIndex: state.routineIndex,
    weightDraft: state.weightDraft,
    repsDraft: state.repsDraft,
    lastTab: state.lastTab,
    editingSession: state.editingSession,
    exerciseSearch: state.exerciseSearch,
    trendsRangeWeeks: state.trendsRangeWeeks,
    trendsExerciseId: state.trendsExerciseId,
  };
}

// Exported (alongside initialState) so the reducer's transitions can be unit tested
// directly without rendering a component tree.
export { initialState };
export function reducer(state, action) {
  switch (action.type) {
    case 'SELECT_PERSON': {
      if (action.personId === state.activePersonId) return state;
      const personSnapshots = { ...state.personSnapshots, [state.activePersonId]: snapshotOf(state) };
      const restored = personSnapshots[action.personId] || {
        selectedExerciseId: null,
        activeRoutineId: null,
        routineIndex: 0,
        weightDraft: 45,
        repsDraft: 8,
        lastTab: '/app/log',
        editingSession: null,
        exerciseSearch: '',
        trendsRangeWeeks: 12,
        trendsExerciseId: null,
      };
      return {
        ...state,
        activePersonId: action.personId,
        personSnapshots,
        ...restored,
      };
    }
    case 'SELECT_EXERCISE':
      return { ...state, selectedExerciseId: action.exerciseId };
    case 'BACK_TO_PICKER':
      return { ...state, selectedExerciseId: null };
    case 'SET_EXERCISE_SEARCH':
      return { ...state, exerciseSearch: action.value };
    case 'SET_LAST_TAB':
      return { ...state, lastTab: action.path };
    case 'SET_TRENDS_RANGE':
      return { ...state, trendsRangeWeeks: action.weeks };
    case 'SELECT_TRENDS_EXERCISE':
      return { ...state, trendsExerciseId: action.exerciseId };
    case 'SET_WEIGHT_DRAFT':
      return { ...state, weightDraft: action.value };
    case 'SET_REPS_DRAFT':
      return { ...state, repsDraft: action.value };
    case 'START_ROUTINE':
      return {
        ...state,
        activeRoutineId: action.routineId,
        routineIndex: 0,
        selectedExerciseId: action.exerciseIds[0] ?? null,
      };
    case 'JUMP_TO_ROUTINE_INDEX':
      return { ...state, routineIndex: action.index, selectedExerciseId: action.exerciseIds[action.index] ?? null };
    case 'NEXT_EXERCISE_IN_ROUTINE': {
      const next = state.routineIndex + 1;
      if (next < action.exerciseIds.length) {
        return { ...state, routineIndex: next, selectedExerciseId: action.exerciseIds[next] };
      }
      return { ...state, activeRoutineId: null, routineIndex: 0, selectedExerciseId: null };
    }
    case 'START_EDITING_SESSION':
      return { ...state, editingSession: action.session, selectedExerciseId: null };
    case 'UPDATE_EDITING_SESSION':
      return { ...state, editingSession: action.session };
    case 'DONE_EDITING_SESSION':
      return { ...state, editingSession: null, selectedExerciseId: null };
    default:
      return state;
  }
}

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

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
      startEditingSession: (session) => dispatch({ type: 'START_EDITING_SESSION', session }),
      updateEditingSession: (session) => dispatch({ type: 'UPDATE_EDITING_SESSION', session }),
      doneEditingSession: () => dispatch({ type: 'DONE_EDITING_SESSION' }),
    }),
    [],
  );

  const value = useMemo(() => ({ ...state, ...actions }), [state, actions]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
