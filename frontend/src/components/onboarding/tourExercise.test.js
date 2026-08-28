import { describe, expect, it } from 'vitest';
import { pickTourExercise, PREFERRED_TOUR_EXERCISES } from './tourExercise';

function ex(overrides) {
  return { id: 1, name: 'Exercise', isFavorite: false, trackingType: 'weight', ...overrides };
}

describe('pickTourExercise', () => {
  it("prefers the person's first favorite", () => {
    const personExercises = [ex({ id: 1, name: 'Curl' }), ex({ id: 2, name: 'Squat', isFavorite: true })];
    expect(pickTourExercise({ personExercises, catalog: [] })).toEqual(personExercises[1]);
  });

  it("falls back to the person's first listed exercise when nothing is favorited", () => {
    const personExercises = [ex({ id: 1, name: 'Curl' }), ex({ id: 2, name: 'Squat' })];
    expect(pickTourExercise({ personExercises, catalog: [] })).toEqual(personExercises[0]);
  });

  it('falls back to a preferred catalog exercise, matched case-insensitively by name', () => {
    const catalog = [ex({ id: 10, name: 'barbell bench press' }), ex({ id: 11, name: 'Zercher Carry' })];
    const result = pickTourExercise({ personExercises: [], catalog });
    expect(result.id).toBe(10);
  });

  it('matches a preferred exercise by name regardless of its id -- ids are per-environment', () => {
    // A seeded catalog's ids differ across local/lower/production, so the match has to work no
    // matter what numeric id this environment happened to assign "Barbell Bench Press".
    const catalog = [ex({ id: 9821, name: 'Barbell Bench Press' }), ex({ id: 3, name: 'Ab Wheel Rollout' })];
    expect(pickTourExercise({ personExercises: [], catalog }).id).toBe(9821);
  });

  it('walks the preferred list in order', () => {
    const catalog = [ex({ id: 1, name: 'Deadlift' }), ex({ id: 2, name: 'Barbell Bench Press' })];
    // Barbell Bench Press is earlier in PREFERRED_TOUR_EXERCISES than Deadlift.
    expect(PREFERRED_TOUR_EXERCISES.indexOf('Barbell Bench Press')).toBeLessThan(PREFERRED_TOUR_EXERCISES.indexOf('Deadlift'));
    expect(pickTourExercise({ personExercises: [], catalog }).name).toBe('Barbell Bench Press');
  });

  it('falls back to the first eligible catalog row sorted by name when nothing preferred matches', () => {
    const catalog = [ex({ id: 1, name: 'Zercher Carry' }), ex({ id: 2, name: 'Ab Wheel Rollout' })];
    expect(pickTourExercise({ personExercises: [], catalog }).name).toBe('Ab Wheel Rollout');
  });

  it('excludes duration-tracked rows everywhere in the fallback chain', () => {
    const favoriteHold = ex({ id: 1, name: 'Plank', isFavorite: true, trackingType: 'duration' });
    const listedLift = ex({ id: 2, name: 'Row', trackingType: 'weight' });
    expect(pickTourExercise({ personExercises: [favoriteHold, listedLift], catalog: [] })).toEqual(listedLift);

    const catalog = [ex({ id: 3, name: 'Wall Sit', trackingType: 'duration' }), ex({ id: 4, name: 'Curl' })];
    expect(pickTourExercise({ personExercises: [], catalog }).id).toBe(4);
  });

  it('excludes temp exercise ids everywhere in the fallback chain', () => {
    const tempFavorite = ex({ id: 'temp-exercise-abc', name: 'Brand New Move', isFavorite: true });
    const realListed = ex({ id: 5, name: 'Row' });
    expect(pickTourExercise({ personExercises: [tempFavorite, realListed], catalog: [] })).toEqual(realListed);

    const catalog = [ex({ id: 'temp-exercise-def', name: 'Another New Move' }), ex({ id: 6, name: 'Curl' })];
    expect(pickTourExercise({ personExercises: [], catalog }).id).toBe(6);
  });

  it('returns null when both lists are empty', () => {
    expect(pickTourExercise({ personExercises: [], catalog: [] })).toBeNull();
  });

  it('returns null when called with nothing at all', () => {
    expect(pickTourExercise()).toBeNull();
  });
});
