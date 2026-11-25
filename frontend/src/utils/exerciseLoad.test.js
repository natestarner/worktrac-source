import { describe, expect, it } from 'vitest';
import {
  EXERCISE_KIND_OPTIONS,
  DEFAULT_EXERCISE_KIND,
  fieldsForKind,
  kindOf,
  loadTypeOf,
  weightLabel,
} from './exerciseLoad';

describe('loadTypeOf', () => {
  it('reads bodyweight only when the row says so', () => {
    expect(loadTypeOf({ loadType: 'bodyweight' })).toBe('bodyweight');
    expect(loadTypeOf({ loadType: 'external' })).toBe('external');
  });

  // Axis D and a newer server: never stuck, at worst one tap on "No weight, just bodyweight".
  it.each([undefined, null, {}, { loadType: 'assisted' }, { loadType: '' }])(
    'reads %o as external',
    (row) => {
      expect(loadTypeOf(row)).toBe('external');
    },
  );
});

describe('weightLabel', () => {
  it('says "Added" for a bodyweight exercise and "Weight" otherwise', () => {
    expect(weightLabel('bodyweight', 'lb')).toBe('Added (lb)');
    expect(weightLabel('external', 'kg')).toBe('Weight (kg)');
  });

  // "Added weight (lb)" wrapped to two lines beside the stepper on an iPhone and pushed its - and +
  // out of line with the Reps row. The bodyweight label must fit wherever "Weight (lb)" does. (The
  // e2e stepper helper finds this row by /^(Weight|Added) \(/ -- support/exercises.ts.)
  it('is never longer than "Weight (unit)"', () => {
    for (const unit of ['lb', 'kg']) {
      expect(weightLabel('bodyweight', unit).length).toBeLessThanOrEqual(weightLabel('external', unit).length);
      expect(weightLabel('bodyweight', unit)).toMatch(/^Added \(/);
    }
  });
});

describe('the "Measured in" choice', () => {
  it('offers three, defaulting to Weight & reps', () => {
    expect(EXERCISE_KIND_OPTIONS.map((o) => o.label)).toEqual(['Weight & reps', 'Bodyweight', 'Time']);
    expect(DEFAULT_EXERCISE_KIND).toBe('weight');
  });

  it('maps each choice onto the two axes and back', () => {
    expect(fieldsForKind('weight')).toEqual({ trackingType: 'strength', loadType: 'external' });
    expect(fieldsForKind('bodyweight')).toEqual({ trackingType: 'strength', loadType: 'bodyweight' });
    expect(fieldsForKind('time')).toEqual({ trackingType: 'duration', loadType: 'bodyweight' });
    for (const { value } of EXERCISE_KIND_OPTIONS) expect(kindOf(fieldsForKind(value))).toBe(value);
  });

  it('reads an exercise from before load types by its measure alone', () => {
    expect(kindOf({ trackingType: 'strength' })).toBe('weight');
    expect(kindOf({ trackingType: 'duration' })).toBe('time');
  });
});
