import { describe, expect, it } from 'vitest';
import { initialState, reducer, PERSON_DEFAULTS } from './AppStateContext';

// The active person's slice, flattened -- mirrors what the provider exposes to consumers.
function active(state) {
  return state.byPerson[state.activePersonId] || PERSON_DEFAULTS;
}

// Convenience: start every scenario with a person already selected, since all draft/routine/tab
// actions operate on the active person's slice (a no-op when there's no active person).
function withPerson(personId) {
  return reducer(initialState, { type: 'SELECT_PERSON', personId });
}

describe('AppStateContext reducer', () => {
  it('selecting a person for the first time seeds the default draft', () => {
    const next = withPerson(1);
    expect(next.activePersonId).toBe(1);
    expect(active(next).weightDraft).toBe(45);
    expect(active(next).repsDraft).toBe(8);
  });

  it('each person has an independent slice -- switching away and back resumes exactly where they left off', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SELECT_EXERCISE', exerciseId: 99 });
    state = reducer(state, { type: 'SET_WEIGHT_DRAFT', value: 185 });

    // Switch to person 2 -- their own (fresh) slice, unaffected by person 1.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(active(state).selectedExerciseId).toBeNull();
    expect(active(state).weightDraft).toBe(45);

    // Switch back to person 1 -- exactly where they left off.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(active(state).selectedExerciseId).toBe(99);
    expect(active(state).weightDraft).toBe(185);
  });

  it('keeps each person on their own last tab', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_LAST_TAB', path: '/app/history' });

    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(active(state).lastTab).toBe('/app/log'); // first switch -> default
    state = reducer(state, { type: 'SET_LAST_TAB', path: '/app/routines' });

    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(active(state).lastTab).toBe('/app/history');
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(active(state).lastTab).toBe('/app/routines');
  });

  it('keeps each person an in-progress past-session edit and a half-typed exercise search', () => {
    let state = withPerson(1);
    const session = { id: 5, startedAt: '2026-01-01T00:00:00Z' };
    state = reducer(state, { type: 'START_EDITING_SESSION', session });
    state = reducer(state, { type: 'SET_EXERCISE_SEARCH', value: 'bench' });

    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(active(state).exerciseSearch).toBe('');
    expect(active(state).editingSession).toBeNull();

    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(active(state).editingSession).toEqual(session);
    expect(active(state).exerciseSearch).toBe('bench');
  });

  it('selecting an exercise clears any in-progress search text', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_EXERCISE_SEARCH', value: 'bench' });
    state = reducer(state, { type: 'SELECT_EXERCISE', exerciseId: 5 });
    expect(active(state).selectedExerciseId).toBe(5);
    expect(active(state).exerciseSearch).toBe('');
  });

  it('starting a routine selects its first exercise', () => {
    const state = reducer(withPerson(1), { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20, 30] });
    expect(active(state).activeRoutineId).toBe(7);
    expect(active(state).routineIndex).toBe(0);
    expect(active(state).selectedExerciseId).toBe(10);
  });

  it('advancing past the last exercise in a routine ends it', () => {
    let state = reducer(withPerson(1), { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20] });
    state = reducer(state, { type: 'NEXT_EXERCISE_IN_ROUTINE', exerciseIds: [10, 20] });
    expect(active(state).routineIndex).toBe(1);
    expect(active(state).selectedExerciseId).toBe(20);

    state = reducer(state, { type: 'NEXT_EXERCISE_IN_ROUTINE', exerciseIds: [10, 20] });
    expect(active(state).activeRoutineId).toBeNull();
    expect(active(state).selectedExerciseId).toBeNull();
  });

  it('done editing session clears both editingSession and selectedExerciseId', () => {
    let state = reducer(withPerson(1), { type: 'START_EDITING_SESSION', session: { id: 5, startedAt: '2026-01-01T00:00:00Z' } });
    state = reducer(state, { type: 'SELECT_EXERCISE', exerciseId: 1 });
    state = reducer(state, { type: 'DONE_EDITING_SESSION' });
    expect(active(state).editingSession).toBeNull();
    expect(active(state).selectedExerciseId).toBeNull();
  });

  it('backing out to the picker while a routine is active preserves routine position for resuming', () => {
    let state = reducer(withPerson(1), { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20, 30] });
    state = reducer(state, { type: 'NEXT_EXERCISE_IN_ROUTINE', exerciseIds: [10, 20, 30] });
    expect(active(state).routineIndex).toBe(1);

    state = reducer(state, { type: 'BACK_TO_PICKER' });
    expect(active(state).selectedExerciseId).toBeNull();
    expect(active(state).activeRoutineId).toBe(7);
    expect(active(state).routineIndex).toBe(1);

    state = reducer(state, { type: 'SELECT_EXERCISE', exerciseId: 999 });
    expect(active(state).selectedExerciseId).toBe(999);
    expect(active(state).activeRoutineId).toBe(7);
    expect(active(state).routineIndex).toBe(1);
  });

  it('keeps each person their own Trends range and drill-down exercise', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_TRENDS_RANGE', weeks: 4 });
    state = reducer(state, { type: 'SELECT_TRENDS_EXERCISE', exerciseId: 42 });

    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(active(state).trendsRangeWeeks).toBe(12);
    expect(active(state).trendsExerciseId).toBeNull();

    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(active(state).trendsRangeWeeks).toBe(4);
    expect(active(state).trendsExerciseId).toBe(42);
  });

  it('keeps each person their own Trends metric selections', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_TRENDS_WEEKLY_METRIC', metric: 'sets' });
    state = reducer(state, { type: 'SET_TRENDS_EXERCISE_METRIC', metric: 'totalReps' });

    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(active(state).trendsWeeklyMetric).toBe('volume');
    expect(active(state).trendsExerciseMetric).toBe('est1rm');

    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(active(state).trendsWeeklyMetric).toBe('sets');
    expect(active(state).trendsExerciseMetric).toBe('totalReps');
  });

  it('ending the routine clears routine progress but leaves the selected exercise alone', () => {
    let state = reducer(withPerson(1), { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20, 30] });
    state = reducer(state, { type: 'NEXT_EXERCISE_IN_ROUTINE', exerciseIds: [10, 20, 30] });
    expect(active(state).routineIndex).toBe(1);

    state = reducer(state, { type: 'END_ROUTINE' });
    expect(active(state).activeRoutineId).toBeNull();
    expect(active(state).routineIndex).toBe(0);
    expect(active(state).selectedExerciseId).toBe(20);
  });

  it('jumping to a routine index selects that position and its exercise', () => {
    let state = reducer(withPerson(1), { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20, 30] });

    state = reducer(state, { type: 'JUMP_TO_ROUTINE_INDEX', index: 2, exerciseIds: [10, 20, 30] });
    expect(active(state).routineIndex).toBe(2);
    expect(active(state).selectedExerciseId).toBe(30);

    state = reducer(state, { type: 'JUMP_TO_ROUTINE_INDEX', index: 0, exerciseIds: [10, 20, 30] });
    expect(active(state).routineIndex).toBe(0);
    expect(active(state).selectedExerciseId).toBe(10);
  });

  it('draft/routine actions are a no-op when there is no active person', () => {
    const state = reducer(initialState, { type: 'SET_WEIGHT_DRAFT', value: 999 });
    expect(state).toBe(initialState);
  });

  it('HYDRATE replaces the whole state (clearing any prior account\'s slices)', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_WEIGHT_DRAFT', value: 185 });

    const restored = reducer(state, {
      type: 'HYDRATE',
      activePersonId: 9,
      byPerson: { 9: { ...PERSON_DEFAULTS, weightDraft: 225 } },
    });
    expect(restored.activePersonId).toBe(9);
    expect(restored.byPerson[1]).toBeUndefined();
    expect(active(restored).weightDraft).toBe(225);
  });

  it('RECONCILE_PEOPLE drops slices for removed people and nulls a dangling active person', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    // Person 2 is now active; remove them from the account.
    const reconciled = reducer(state, { type: 'RECONCILE_PEOPLE', personIds: [1] });
    expect(reconciled.byPerson[2]).toBeUndefined();
    expect(reconciled.byPerson[1]).toBeDefined();
    expect(reconciled.activePersonId).toBeNull();
  });

  it('RECONCILE_PEOPLE returns the same state reference when nothing changed (no render loop)', () => {
    let state = withPerson(1);
    const reconciled = reducer(state, { type: 'RECONCILE_PEOPLE', personIds: [1, 2, 3] });
    expect(reconciled).toBe(state);
  });

  it('HYDRATE with resetTab resets every restored person back to the Log tab (a fresh login)', () => {
    const restored = reducer(initialState, {
      type: 'HYDRATE',
      activePersonId: 1,
      byPerson: {
        1: { ...PERSON_DEFAULTS, lastTab: '/app/trends', weightDraft: 225 },
        2: { ...PERSON_DEFAULTS, lastTab: '/app/history' },
      },
      resetTab: true,
    });
    expect(restored.byPerson[1].lastTab).toBe('/app/log');
    expect(restored.byPerson[2].lastTab).toBe('/app/log');
    // Only the tab is reset -- the rest of each person's restored slice is untouched.
    expect(restored.byPerson[1].weightDraft).toBe(225);
  });

  it('HYDRATE without resetTab (a mid-session reload) leaves each person\'s last tab alone', () => {
    const restored = reducer(initialState, {
      type: 'HYDRATE',
      activePersonId: 1,
      byPerson: { 1: { ...PERSON_DEFAULTS, lastTab: '/app/trends' } },
    });
    expect(restored.byPerson[1].lastTab).toBe('/app/trends');
  });

  // A slice written before a field was added to PERSON_DEFAULTS must not hydrate that field as
  // undefined -- that shipped a crash-on-hover to every existing user once, and every future
  // field added here would repeat it. See docs/incidents/2026-08-08-trends-hover-blank-page.md.
  it('HYDRATE backfills defaults for fields a persisted slice predates', () => {
    const slicePersistedBeforeTheseFieldsExisted = { selectedExerciseId: 7, weightDraft: 225 };
    const restored = reducer(initialState, {
      type: 'HYDRATE',
      activePersonId: 1,
      byPerson: { 1: slicePersistedBeforeTheseFieldsExisted },
    });

    expect(restored.byPerson[1].trendsWeeklyMetric).toBe('volume');
    expect(restored.byPerson[1].prsSort).toBe('recent');
    // Backfilling must not clobber what WAS persisted.
    expect(restored.byPerson[1].selectedExerciseId).toBe(7);
    expect(restored.byPerson[1].weightDraft).toBe(225);
  });

  it('HYDRATE backfills defaults on the resetTab path too', () => {
    const restored = reducer(initialState, {
      type: 'HYDRATE',
      activePersonId: 1,
      byPerson: { 1: { weightDraft: 225, lastTab: '/app/trends' } },
      resetTab: true,
    });
    expect(restored.byPerson[1].trendsWeeklyMetric).toBe('volume');
    expect(restored.byPerson[1].lastTab).toBe('/app/log');
  });

  it('SET_PRS_SORT is per person -- one board\'s order never reorders another\'s', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_PRS_SORT', sort: 'est1rm' });
    expect(active(state).prsSort).toBe('est1rm');

    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(active(state).prsSort).toBe('recent');

    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(active(state).prsSort).toBe('est1rm');
  });
});
