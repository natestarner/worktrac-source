import { describe, expect, it } from 'vitest';
import { initialState, reducer, selectRestTimersByPerson, PERSON_DEFAULTS } from './AppStateContext';

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
    // null == "no history yet", not a weight. The prefill effect replaces it as soon as the
    // exercise summary resolves -- see utils/formulas.js#computePrefillDraft.
    expect(active(next).weightDraft).toBeNull();
    expect(active(next).repsDraft).toBe(8);
  });

  it('each person has an independent slice -- switching away and back resumes exactly where they left off', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SELECT_EXERCISE', exerciseId: 99 });
    state = reducer(state, { type: 'SET_DRAFT', exerciseId: 99, weight: 185, reps: 5, setCount: 0, source: 'user' });

    // Switch to person 2 -- their own (fresh) slice, unaffected by person 1.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(active(state).selectedExerciseId).toBeNull();
    expect(active(state).weightDraft).toBeNull();

    // Switch back to person 1 -- exactly where they left off.
    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(active(state).selectedExerciseId).toBe(99);
    expect(active(state).weightDraft).toBe(185);
  });

  // The stamp is what tells ExerciseDetail whether the numbers in this slice describe the exercise
  // currently on screen and whether the person typed them. A partial write -- weight stamped to the
  // new exercise while reps still holds the old one's -- is the same bug the stamp exists to
  // prevent, so there is deliberately no way to set one without the other.
  it('SET_DRAFT writes both numbers and the whole stamp together', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_DRAFT', exerciseId: 42, weight: 315, reps: 2, setCount: 3, source: 'user' });

    expect(active(state)).toMatchObject({
      weightDraft: 315,
      repsDraft: 2,
      draftExerciseId: 42,
      draftSetCount: 3,
      draftSource: 'user',
    });
  });

  it('SET_DRAFT carries a null weight through as "no history yet"', () => {
    // null is a display state (em dash), not an absent value -- it must survive the round trip
    // rather than being coerced to 0, which would claim the person is lifting zero.
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_DRAFT', exerciseId: 42, weight: null, reps: 8, setCount: 0, source: 'prefill' });

    expect(active(state).weightDraft).toBeNull();
    expect(active(state).draftSource).toBe('prefill');
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
    const state = reducer(initialState, {
      type: 'SET_DRAFT',
      exerciseId: 1,
      weight: 999,
      reps: 8,
      setCount: 0,
      source: 'user',
    });
    expect(state).toBe(initialState);
  });

  it('HYDRATE replaces the whole state (clearing any prior account\'s slices)', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_DRAFT', exerciseId: 1, weight: 185, reps: 5, setCount: 0, source: 'user' });

    const restored = reducer(state, {
      type: 'HYDRATE',
      activePersonId: 9,
      byPerson: { 9: { ...PERSON_DEFAULTS, weightDraft: 225 } },
    });
    expect(restored.activePersonId).toBe(9);
    expect(restored.byPerson[1]).toBeUndefined();
    expect(active(restored).weightDraft).toBe(225);
  });

  // ⚠️ The UPGRADE path, not a fresh profile. durationDraft and holdStartedAt were added to
  // PERSON_DEFAULTS after people already had persisted slices, so every existing install hydrates
  // a slice that predates them. Without HYDRATE's {...PERSON_DEFAULTS, ...slice} underlay they'd
  // come back `undefined` -- which is exactly how the Trends weekly-metric switcher blanked the
  // page on hover for everyone who had used the app before it shipped
  // (docs/incidents/2026-08-08-trends-hover-blank-page.md). A brand-new person never reproduces it.
  it('HYDRATE fills in draft fields added after a slice was persisted', () => {
    const sliceFromBeforeThisFeature = {
      selectedExerciseId: 4,
      weightDraft: 135,
      repsDraft: 8,
      draftExerciseId: 4,
      draftSetCount: 2,
      draftSource: 'user',
      lastTab: '/app/log',
    };

    const restored = reducer(initialState, {
      type: 'HYDRATE',
      activePersonId: 1,
      byPerson: { 1: sliceFromBeforeThisFeature },
    });

    expect(active(restored).durationDraft).toBe(PERSON_DEFAULTS.durationDraft);
    expect(active(restored).holdStartedAt).toBeNull();
    // The persisted values themselves must survive the underlay.
    expect(active(restored).weightDraft).toBe(135);
    expect(active(restored).draftSource).toBe('user');
  });

  // Both rest fields are written together, always. A start with no target would resume against the
  // app default instead of the target that was actually in force when the set was logged -- which
  // is the same class of bug as re-deriving the target from whatever exercise is on screen.
  it('SET_REST_TIMER writes the start and its target together, and clears both as a pair', () => {
    let state = withPerson(1);

    state = reducer(state, { type: 'SET_REST_TIMER', startedAt: 1700000000000, targetSeconds: 120 });
    expect(active(state).restStartedAt).toBe(1700000000000);
    expect(active(state).restTargetSeconds).toBe(120);

    state = reducer(state, { type: 'SET_REST_TIMER', startedAt: null, targetSeconds: null });
    expect(active(state).restStartedAt).toBeNull();
    expect(active(state).restTargetSeconds).toBeNull();
  });

  // Clearing is expressed as "no start", so a clear that forgot to null the target must not leave a
  // stale one behind for the next resume to pick up.
  it('SET_REST_TIMER drops the target whenever the start is cleared', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_REST_TIMER', startedAt: 1700000000000, targetSeconds: 120 });

    state = reducer(state, { type: 'SET_REST_TIMER', startedAt: null, targetSeconds: 120 });
    expect(active(state).restTargetSeconds).toBeNull();
  });

  // Per-person isolation: the rest timer is one person's state, and switching people must not
  // carry it across.
  it('SET_REST_TIMER defaults to the active person', () => {
    let state = reducer(withPerson(1), { type: 'SET_REST_TIMER', startedAt: 1700000000000, targetSeconds: 90 });
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });

    expect(active(state).restStartedAt).toBeNull();
    expect(state.byPerson[1].restStartedAt).toBe(1700000000000);
  });

  // Starting a timer is always the active person, but DISCARDING an expired one on boot is not:
  // that runs for every household member at once. Without an explicit target the boot sweep could
  // only ever clear one of them -- and would silently clear the WRONG person's.
  it('SET_REST_TIMER can target a person who is not active', () => {
    let state = reducer(withPerson(1), { type: 'SET_REST_TIMER', startedAt: 1700000000000, targetSeconds: 90 });
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });

    state = reducer(state, { type: 'SET_REST_TIMER', personId: 1, startedAt: null, targetSeconds: null });

    expect(state.byPerson[1].restStartedAt).toBeNull();
    // ...and left the active person alone.
    expect(state.byPerson[2].restStartedAt).toBeNull();
  });

  it('SET_REST_TIMER targeting a person seeds their slice from the defaults', () => {
    const state = reducer(withPerson(1), {
      type: 'SET_REST_TIMER',
      personId: 5,
      startedAt: 1700000000000,
      targetSeconds: 120,
    });

    expect(state.byPerson[5].restStartedAt).toBe(1700000000000);
    expect(state.byPerson[5].repsDraft).toBe(PERSON_DEFAULTS.repsDraft);
  });
});

// The projection AppShell resumes from. It spans EVERY person, which is the whole point: a reload
// used to restore only the active person's timer, so the ring belonging to whoever was NOT holding
// the device -- the one the feature exists for -- vanished until you switched to them.
describe('selectRestTimersByPerson', () => {
  it('returns every person with a persisted rest timer, not just one', () => {
    const byPerson = {
      1: { ...PERSON_DEFAULTS, restStartedAt: 1700000000000, restTargetSeconds: 90 },
      2: { ...PERSON_DEFAULTS, restStartedAt: 1700000005000, restTargetSeconds: 120 },
    };

    expect(selectRestTimersByPerson(byPerson)).toEqual({
      1: { startedAt: 1700000000000, targetSeconds: 90 },
      2: { startedAt: 1700000005000, targetSeconds: 120 },
    });
  });

  it('omits people who are not resting', () => {
    const byPerson = {
      1: { ...PERSON_DEFAULTS, restStartedAt: 1700000000000, restTargetSeconds: 90 },
      2: { ...PERSON_DEFAULTS },
    };

    expect(Object.keys(selectRestTimersByPerson(byPerson))).toEqual(['1']);
  });

  // A slice persisted before the target existed carries a start but no target. It must still
  // resume -- against the app default -- rather than being dropped.
  it('keeps a person whose target is missing, reporting it as null', () => {
    const byPerson = { 1: { ...PERSON_DEFAULTS, restStartedAt: 1700000000000, restTargetSeconds: undefined } };

    expect(selectRestTimersByPerson(byPerson)).toEqual({ 1: { startedAt: 1700000000000, targetSeconds: null } });
  });

  it('is empty for a household where nobody is resting', () => {
    expect(selectRestTimersByPerson({ 1: { ...PERSON_DEFAULTS } })).toEqual({});
  });

  it('SET_DRAFT writes the duration alongside weight/reps and the whole stamp', () => {
    let state = withPerson(1);
    state = reducer(state, {
      type: 'SET_DRAFT',
      exerciseId: 7,
      weight: 0,
      reps: 0,
      durationSeconds: 75,
      setCount: 1,
      source: 'user',
    });
    expect(active(state).durationDraft).toBe(75);
    expect(active(state).draftExerciseId).toBe(7);
    expect(active(state).draftSource).toBe('user');
  });

  // Starting a hold says nothing about who owns the drafts, so it must not restamp them --
  // otherwise tapping the timer would hand a prefilled weight to the person as if they'd typed it.
  it('SET_HOLD_STARTED_AT does not touch the draft stamp', () => {
    let state = withPerson(1);
    state = reducer(state, {
      type: 'SET_DRAFT',
      exerciseId: 7,
      weight: 0,
      reps: 0,
      durationSeconds: 30,
      setCount: 0,
      source: 'prefill',
    });
    state = reducer(state, { type: 'SET_HOLD_STARTED_AT', startedAt: 1755000000000 });

    expect(active(state).holdStartedAt).toBe(1755000000000);
    expect(active(state).draftSource).toBe('prefill');
    expect(active(state).draftExerciseId).toBe(7);
  });

  it('the hold timestamp is per person, like every other draft field', () => {
    let state = withPerson(1);
    state = reducer(state, { type: 'SET_HOLD_STARTED_AT', startedAt: 111 });
    state = reducer(state, { type: 'SELECT_PERSON', personId: 2 });
    expect(active(state).holdStartedAt).toBeNull();

    state = reducer(state, { type: 'SELECT_PERSON', personId: 1 });
    expect(active(state).holdStartedAt).toBe(111);
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
    // The draft stamp is the newest such field. Hydrating draftExerciseId as null (rather than
    // undefined) is what makes the restored weightDraft below read as "belongs to no exercise on
    // screen" instead of being painted under whatever exercise the person lands on.
    expect(restored.byPerson[1].draftExerciseId).toBeNull();
    expect(restored.byPerson[1].draftSetCount).toBe(0);
    expect(restored.byPerson[1].draftSource).toBe('prefill');
    // The rest-timer pair is the newest such field. A slice from before the session bar shipped
    // must hydrate them as null, not undefined -- AppShell's resume reads restStartedAt directly on
    // mount, so an undefined there is evaluated on literally every existing install's first boot
    // after the deploy.
    expect(restored.byPerson[1].restStartedAt).toBeNull();
    expect(restored.byPerson[1].restTargetSeconds).toBeNull();
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
