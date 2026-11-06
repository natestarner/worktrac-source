import { describe, it, expect } from 'vitest';
import shared from '../../../shared/muscles/muscles.json';
import { MUSCLES, muscleName, exerciseMuscles } from './muscles';

// The server sends muscle CODES; every name a person reads comes from MUSCLES. So the two lists
// drifting apart is invisible on both sides: the server sends a code the client drops, or the
// client offers one the server's foreign key refuses. shared/muscles/muscles.json is the agreed
// list -- this checks the client against it, LibraryExerciseMusclesTest checks the database.
describe('MUSCLES', () => {
  it('equals the shared vocabulary, in its order', () => {
    expect(shared.muscles.length).toBeGreaterThan(15);
    expect(MUSCLES).toEqual(shared.muscles);
  });
});

describe('exerciseMuscles', () => {
  it('reads both lists off a catalog row', () => {
    expect(exerciseMuscles({ primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'] })).toEqual({
      primary: ['chest'],
      secondary: ['shoulders', 'triceps'],
    });
  });

  // A catalog cached before the fields existed, and a temp row created offline, have neither.
  it('treats absent fields as empty', () => {
    expect(exerciseMuscles({ id: 'temp-exercise-1', name: 'Zercher Squat' })).toEqual({ primary: [], secondary: [] });
    expect(exerciseMuscles(undefined)).toEqual({ primary: [], secondary: [] });
    expect(exerciseMuscles({ primaryMuscles: null })).toEqual({ primary: [], secondary: [] });
  });

  // An App Store build lives for months; a muscle the server adds later must not render as a raw code.
  it('drops codes this build does not know', () => {
    expect(exerciseMuscles({ primaryMuscles: ['chest', 'serratus'], secondaryMuscles: [] }).primary).toEqual(['chest']);
    expect(muscleName('serratus')).toBeUndefined();
    expect(muscleName('rear_delts')).toBe('Rear delts');
  });
});
