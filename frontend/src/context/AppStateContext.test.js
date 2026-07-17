import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './AppStateContext';

describe('AppStateContext reducer', () => {
  it('selecting a person for the first time uses the default draft', () => {
    const next = reducer(initialState, { type: 'SELECT_PERSON', personId: 1 });
    expect(next.activePersonId).toBe(1);
    expect(next.weightDraft).toBe(45);
    expect(next.repsDraft).toBe(8);
  });

  it('switching people snapshots the old person and restores the new one on return', () => {
    let state = reducer(initialState, { type: 'SELECT_PERSON', personId: 1 });
    state = reducer(state, { type: 'SELECT_EXERCISE', exerciseId: 99 });
    state = reducer(state, { type: 'SET_WEIGHT_DRAFT', value: 185 });

    // Switch to person 2 -- person 1's in-progress state should be snapshotted.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(state.selectedExerciseId).toBeNull();
    expect(state.weightDraft).toBe(45);

    // Switch back to person 1 -- exactly where they left off.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(state.selectedExerciseId).toBe(99);
    expect(state.weightDraft).toBe(185);
  });

  it('switching people snapshots and restores which tab each person was on', () => {
    let state = reducer(initialState, { type: 'SELECT_PERSON', personId: 1 });
    state = reducer(state, { type: 'SET_LAST_TAB', path: '/app/history' });

    // A person switched to for the first time defaults to the Log tab.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(state.lastTab).toBe('/app/log');
    state = reducer(state, { type: 'SET_LAST_TAB', path: '/app/routines' });

    // Switching back restores each person's own last tab, not whichever was viewed
    // most recently overall.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(state.lastTab).toBe('/app/history');
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(state.lastTab).toBe('/app/routines');
  });

  it('switching people preserves both an in-progress past-session edit and a half-typed exercise search', () => {
    let state = reducer(initialState, { type: 'SELECT_PERSON', personId: 1 });
    const session = { id: 5, startedAt: '2026-01-01T00:00:00Z' };
    state = reducer(state, { type: 'START_EDITING_SESSION', session });
    state = reducer(state, { type: 'SET_EXERCISE_SEARCH', value: 'bench' });

    // Person 2 has never been switched to before -- everything defaults fresh,
    // regardless of what person 1 was doing.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(state.exerciseSearch).toBe('');
    expect(state.editingSession).toBeNull();

    // Switching back to person 1 resumes exactly what they were doing: the same
    // past-session edit and the same search text.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(state.editingSession).toEqual(session);
    expect(state.exerciseSearch).toBe('bench');
  });

  it('selecting an exercise clears any in-progress search text', () => {
    let state = reducer(initialState, { type: 'SET_EXERCISE_SEARCH', value: 'bench' });
    state = reducer(state, { type: 'SELECT_EXERCISE', exerciseId: 5 });
    expect(state.selectedExerciseId).toBe(5);
    expect(state.exerciseSearch).toBe('');
  });

  it('starting a routine selects its first exercise', () => {
    const state = reducer(initialState, { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20, 30] });
    expect(state.activeRoutineId).toBe(7);
    expect(state.routineIndex).toBe(0);
    expect(state.selectedExerciseId).toBe(10);
  });

  it('advancing past the last exercise in a routine ends it', () => {
    let state = reducer(initialState, { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20] });
    state = reducer(state, { type: 'NEXT_EXERCISE_IN_ROUTINE', exerciseIds: [10, 20] });
    expect(state.routineIndex).toBe(1);
    expect(state.selectedExerciseId).toBe(20);

    state = reducer(state, { type: 'NEXT_EXERCISE_IN_ROUTINE', exerciseIds: [10, 20] });
    expect(state.activeRoutineId).toBeNull();
    expect(state.selectedExerciseId).toBeNull();
  });

  it('done editing session clears both editingSession and selectedExerciseId', () => {
    let state = reducer(initialState, { type: 'START_EDITING_SESSION', session: { id: 5, startedAt: '2026-01-01T00:00:00Z' } });
    state = reducer(state, { type: 'SELECT_EXERCISE', exerciseId: 1 });
    state = reducer(state, { type: 'DONE_EDITING_SESSION' });
    expect(state.editingSession).toBeNull();
    expect(state.selectedExerciseId).toBeNull();
  });

  it('backing out to the picker while a routine is active preserves routine position for resuming', () => {
    let state = reducer(initialState, { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20, 30] });
    state = reducer(state, { type: 'NEXT_EXERCISE_IN_ROUTINE', exerciseIds: [10, 20, 30] });
    expect(state.routineIndex).toBe(1);

    // Logging an off-routine exercise goes through BACK_TO_PICKER + SELECT_EXERCISE --
    // only selectedExerciseId should change; activeRoutineId/routineIndex must survive
    // untouched so the routine can be resumed afterward.
    state = reducer(state, { type: 'BACK_TO_PICKER' });
    expect(state.selectedExerciseId).toBeNull();
    expect(state.activeRoutineId).toBe(7);
    expect(state.routineIndex).toBe(1);

    state = reducer(state, { type: 'SELECT_EXERCISE', exerciseId: 999 });
    expect(state.selectedExerciseId).toBe(999);
    expect(state.activeRoutineId).toBe(7);
    expect(state.routineIndex).toBe(1);
  });

  it('switching people snapshots and restores the Trends range and drill-down exercise', () => {
    let state = reducer(initialState, { type: 'SELECT_PERSON', personId: 1 });
    state = reducer(state, { type: 'SET_TRENDS_RANGE', weeks: 4 });
    state = reducer(state, { type: 'SELECT_TRENDS_EXERCISE', exerciseId: 42 });

    // A person switched to for the first time defaults fresh.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(state.trendsRangeWeeks).toBe(12);
    expect(state.trendsExerciseId).toBeNull();

    // Switching back to person 1 resumes their own range and exercise selection.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(state.trendsRangeWeeks).toBe(4);
    expect(state.trendsExerciseId).toBe(42);
  });

  it('ending the routine (e.g. when the workout itself is ended) clears routine progress but leaves the selected exercise alone', () => {
    let state = reducer(initialState, { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20, 30] });
    state = reducer(state, { type: 'NEXT_EXERCISE_IN_ROUTINE', exerciseIds: [10, 20, 30] });
    expect(state.routineIndex).toBe(1);

    state = reducer(state, { type: 'END_ROUTINE' });
    expect(state.activeRoutineId).toBeNull();
    expect(state.routineIndex).toBe(0);
    expect(state.selectedExerciseId).toBe(20);
  });

  it('jumping to a routine index selects that position and its exercise', () => {
    let state = reducer(initialState, { type: 'START_ROUTINE', routineId: 7, exerciseIds: [10, 20, 30] });

    state = reducer(state, { type: 'JUMP_TO_ROUTINE_INDEX', index: 2, exerciseIds: [10, 20, 30] });
    expect(state.routineIndex).toBe(2);
    expect(state.selectedExerciseId).toBe(30);

    // Jumping back to an earlier index (e.g. resuming after an off-routine detour)
    // works the same way.
    state = reducer(state, { type: 'JUMP_TO_ROUTINE_INDEX', index: 0, exerciseIds: [10, 20, 30] });
    expect(state.routineIndex).toBe(0);
    expect(state.selectedExerciseId).toBe(10);
  });
});
