import { describe, it, expect } from 'vitest';
import { MEASURE_OPTIONS, measureLabel, resolveExerciseCreate } from './exerciseDuplicates';

const bench = { id: 1, name: 'Bench Press', trackingType: 'strength', isGlobal: true };
const plank = { id: 2, name: 'Plank', trackingType: 'duration', isGlobal: true };

function resolve(catalog, name, trackingType = 'strength') {
  return resolveExerciseCreate({ catalog, name, trackingType });
}

describe('measureLabel', () => {
  it('names each measure exactly as the "Measured in" toggle does', () => {
    // The suffix has to read back as the word the person tapped, so both come from one list.
    expect(MEASURE_OPTIONS).toEqual([
      { label: 'Reps', value: 'strength' },
      { label: 'Time', value: 'duration' },
    ]);
    expect(measureLabel('strength')).toBe('Reps');
    expect(measureLabel('duration')).toBe('Time');
    expect(measureLabel(undefined)).toBe('Reps');
  });
});

describe('resolveExerciseCreate', () => {
  it('creates under the name as typed when nothing matches', () => {
    expect(resolve([bench, plank], 'Zercher Squat')).toEqual({
      kind: 'create',
      name: 'Zercher Squat',
      clashWith: null,
    });
  });

  it('creates when the catalog is empty or missing -- it degrades, it never blocks', () => {
    // The offline case that matters: a device that has never warmed the catalog finds nothing and
    // gets exactly today's behaviour. ExerciseService.add converges the duplicate on sync.
    expect(resolve([], 'Bench Press')).toEqual({ kind: 'create', name: 'Bench Press', clashWith: null });
    expect(resolveExerciseCreate({ catalog: undefined, name: 'Bench Press', trackingType: 'strength' })).toEqual({
      kind: 'create',
      name: 'Bench Press',
      clashWith: null,
    });
  });

  it('opens the existing exercise when name AND measure both match', () => {
    expect(resolve([bench, plank], 'Bench Press')).toEqual({ kind: 'open', exercise: bench });
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    // Must agree with SQL Server's case-insensitive collation, or a "bench press" the client let
    // through would resolve to the existing row on sync and the person's "new" exercise would
    // silently not exist.
    expect(resolve([bench], '  bench PRESS  ')).toEqual({ kind: 'open', exercise: bench });
  });

  it('suffixes the new exercise with its measure when the name clashes on the other measure', () => {
    expect(resolve([plank], 'Plank', 'strength')).toEqual({
      kind: 'create',
      name: 'Plank (Reps)',
      clashWith: plank,
    });
    const repsPlank = { id: 3, name: 'Plank', trackingType: 'strength', isGlobal: false };
    expect(resolve([repsPlank], 'Plank', 'duration')).toEqual({
      kind: 'create',
      name: 'Plank (Time)',
      clashWith: repsPlank,
    });
  });

  it('never renames or otherwise touches the exercise it clashed with', () => {
    const before = { ...plank };
    resolve([plank], 'Plank', 'strength');
    expect(plank).toEqual(before);
  });

  it('opens the suffixed exercise when the suffixed name is itself already taken', () => {
    // "Plank" (Reps) and "Plank (Time)" both exist and the person types "Plank" with Time selected.
    // Suffixing here would create the very duplicate this function exists to prevent.
    const repsPlank = { id: 3, name: 'Plank', trackingType: 'strength', isGlobal: false };
    const timedPlank = { id: 4, name: 'Plank (Time)', trackingType: 'duration', isGlobal: false };
    expect(resolve([repsPlank, timedPlank], 'Plank', 'duration')).toEqual({
      kind: 'open',
      exercise: timedPlank,
    });
  });

  it('counts an optimistic temp row as a duplicate', () => {
    // An exercise created moments ago and still queued in the outbox is a duplicate as far as the
    // person is concerned, and its temp id is selectable and loggable exactly like a real one.
    const temp = { id: 'temp-exercise-abc', name: 'Zercher Squat', trackingType: 'strength', isGlobal: false, optimistic: true };
    expect(resolve([temp], 'Zercher Squat')).toEqual({ kind: 'open', exercise: temp });
  });

  it('prefers a real exercise over an optimistic temp one', () => {
    // A temp row's create can still fail; a real row is one the server has already confirmed.
    const temp = { id: 'temp-exercise-abc', name: 'Bench Press', trackingType: 'strength', isGlobal: false };
    expect(resolve([temp, bench], 'Bench Press').exercise).toBe(bench);
  });

  it("prefers the account's own exercise over a global one", () => {
    // If a household has its own "Bench Press" beside the preloaded one, theirs is the one they
    // have been logging against.
    const own = { id: 90, name: 'Bench Press', trackingType: 'strength', isGlobal: false };
    expect(resolve([bench, own], 'Bench Press').exercise).toBe(own);
  });

  it('breaks a remaining tie on lowest id, so repeat lookups agree', () => {
    // Duplicates already exist in the data -- nothing prevented them until now -- and this feeds a
    // navigation the person will keep landing on, so it must not depend on array order.
    const a = { id: 12, name: 'Row', trackingType: 'strength', isGlobal: false };
    const b = { id: 7, name: 'Row', trackingType: 'strength', isGlobal: false };
    expect(resolve([a, b], 'Row').exercise).toBe(b);
    expect(resolve([b, a], 'Row').exercise).toBe(b);
  });

  it('treats a missing trackingType on a catalog row as strength', () => {
    const legacy = { id: 5, name: 'Curl', isGlobal: false };
    expect(resolve([legacy], 'Curl', 'strength')).toEqual({ kind: 'open', exercise: legacy });
    expect(resolve([legacy], 'Curl', 'duration')).toEqual({
      kind: 'create',
      name: 'Curl (Time)',
      clashWith: legacy,
    });
  });

  it('drops the suffix rather than exceed the name column', () => {
    // exercises.name is NVARCHAR(200) with no @Size on the request, so an over-long name is a 500,
    // and shouldRetryWrite retries a 5xx forever -- head-of-line-blocking the whole serial outbox.
    // Two rows sharing a name is cosmetic; a wedged outbox is not.
    const long = 'P'.repeat(196); // 196 + ' (Time)' = 203
    const clash = { id: 9, name: long, trackingType: 'strength', isGlobal: false };
    expect(resolve([clash], long, 'duration')).toEqual({ kind: 'create', name: long, clashWith: clash });
  });

  it('still suffixes when the result fits exactly', () => {
    const long = 'P'.repeat(193); // 193 + ' (Time)' = 200
    const clash = { id: 9, name: long, trackingType: 'strength', isGlobal: false };
    expect(resolve([clash], long, 'duration').name).toBe(`${long} (Time)`);
    expect(resolve([clash], long, 'duration').name).toHaveLength(200);
  });

  it('returns a plain create for a blank name -- the modal rejects it before saving', () => {
    expect(resolve([bench], '   ')).toEqual({ kind: 'create', name: '', clashWith: null });
  });
});
