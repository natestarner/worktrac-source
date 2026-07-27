import { describe, expect, it } from 'vitest';
import { describeOutboxMutation } from './outboxDescribe';
import { newTempExerciseId } from './exerciseIdMap';

const peopleById = { 7: { id: 7, name: 'Nate' } };
const exercisesById = { 42: { id: 42, name: 'Bench Press' } };

describe('describeOutboxMutation', () => {
  it('describes a logged set', () => {
    const result = describeOutboxMutation(
      { mutationKey: ['logSet', 7, 42], variables: { personId: 7, exerciseId: 42, weight: 135, reps: 5, unit: 'lb' } },
      { peopleById, exercisesById },
    );
    expect(result).toEqual({ kind: 'logSet', personName: 'Nate', exerciseName: 'Bench Press', detail: 'logged 135 lb × 5' });
  });

  it('describes creating an exercise, using the submitted name (not yet in the catalog)', () => {
    const result = describeOutboxMutation(
      { mutationKey: ['createExercise'], variables: { personId: 7, name: 'Zercher Squat' } },
      { peopleById, exercisesById },
    );
    expect(result).toEqual({ kind: 'createExercise', personName: 'Nate', exerciseName: 'Zercher Squat', detail: 'created this exercise' });
  });

  it('describes editing a set without guessing a unit', () => {
    const result = describeOutboxMutation(
      { mutationKey: ['editSet'], variables: { personId: 7, exerciseId: 42, weight: 140, reps: 4 } },
      { peopleById, exercisesById },
    );
    expect(result.detail).toBe('edited a set to 140 × 4');
  });

  it('describes deleting a set', () => {
    const result = describeOutboxMutation(
      { mutationKey: ['deleteSet'], variables: { personId: 7, exerciseId: 42 } },
      { peopleById, exercisesById },
    );
    expect(result.detail).toBe('deleted a set');
  });

  it('describes saving a non-blank note as an update, and a blank one as clearing it', () => {
    const updated = describeOutboxMutation(
      { mutationKey: ['saveNote'], variables: { personId: 7, exerciseId: 42, note: 'keep elbows tucked' } },
      { peopleById, exercisesById },
    );
    expect(updated.detail).toBe('updated the note');

    const cleared = describeOutboxMutation(
      { mutationKey: ['saveNote'], variables: { personId: 7, exerciseId: 42, note: '   ' } },
      { peopleById, exercisesById },
    );
    expect(cleared.detail).toBe('cleared the note');
  });

  it('describes ending a workout with no exercise attached', () => {
    const result = describeOutboxMutation(
      { mutationKey: ['endWorkout'], variables: { personId: 7 } },
      { peopleById, exercisesById },
    );
    expect(result).toEqual({ kind: 'endWorkout', personName: 'Nate', exerciseName: null, detail: 'ended the workout' });
  });

  it('describes favoriting and unfavoriting', () => {
    const favorited = describeOutboxMutation(
      { mutationKey: ['favorite'], variables: { personId: 7, exerciseId: 42, favorite: true } },
      { peopleById, exercisesById },
    );
    expect(favorited.detail).toBe('added to favorites');

    const unfavorited = describeOutboxMutation(
      { mutationKey: ['favorite'], variables: { personId: 7, exerciseId: 42, favorite: false } },
      { peopleById, exercisesById },
    );
    expect(unfavorited.detail).toBe('removed from favorites');
  });

  it('resolves an offline-created exercise (temp id) by name via the sibling createExercise mutation', () => {
    const tempId = newTempExerciseId();
    const result = describeOutboxMutation(
      { mutationKey: ['logSet', 7, tempId], variables: { personId: 7, exerciseId: tempId, weight: 45, reps: 10, unit: 'lb' } },
      { peopleById, exercisesById, tempExerciseNames: { [tempId]: 'Zercher Squat' } },
    );
    expect(result.exerciseName).toBe('Zercher Squat');
  });

  it('falls back gracefully when a temp exercise name is not yet known', () => {
    const tempId = newTempExerciseId();
    const result = describeOutboxMutation(
      { mutationKey: ['logSet', 7, tempId], variables: { personId: 7, exerciseId: tempId, weight: 45, reps: 10, unit: 'lb' } },
      { peopleById, exercisesById, tempExerciseNames: {} },
    );
    expect(result.exerciseName).toBe('a new exercise');
  });

  it('falls back gracefully for an unknown person or exercise id', () => {
    const result = describeOutboxMutation(
      { mutationKey: ['logSet', 99, 999], variables: { personId: 99, exerciseId: 999, weight: 45, reps: 10 } },
      { peopleById, exercisesById },
    );
    expect(result.personName).toBe('Someone');
    expect(result.exerciseName).toBe('an exercise');
  });

  it('prefers the name carried on the mutation itself over the catalog lookup, so a reload with an empty/refetching catalog still shows the real name', () => {
    const result = describeOutboxMutation(
      { mutationKey: ['logSet', 7, 42], variables: { personId: 7, exerciseId: 42, exerciseName: 'Bench Press', weight: 135, reps: 5, unit: 'lb' } },
      { peopleById, exercisesById: {} }, // catalog empty, as it is right after a reload
    );
    expect(result.exerciseName).toBe('Bench Press');
  });
});
