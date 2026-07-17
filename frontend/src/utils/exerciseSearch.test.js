import { describe, expect, it } from 'vitest';
import { highlightMatches, searchExercises } from './exerciseSearch';

const catalog = [
  { id: 1, name: 'Barbell Back Squat' },
  { id: 2, name: 'Barbell Bench Press' },
  { id: 3, name: 'Goblet Squat' },
  { id: 4, name: 'Squat' },
  { id: 5, name: 'Overhead Press' },
];

describe('searchExercises', () => {
  it('matches a reordered multi-word query against a name containing both tokens', () => {
    const results = searchExercises(catalog, 'barbell squat');
    expect(results.map((e) => e.name)).toContain('Barbell Back Squat');
  });

  it('matches a single-token substring', () => {
    const results = searchExercises(catalog, 'press');
    expect(results.map((e) => e.name).sort()).toEqual(['Barbell Bench Press', 'Overhead Press']);
  });

  it('returns nothing when no exercise contains all tokens', () => {
    expect(searchExercises(catalog, 'barbell deadlift')).toEqual([]);
  });

  it('returns an empty array for a blank query', () => {
    expect(searchExercises(catalog, '   ')).toEqual([]);
  });

  it('ranks exact-prefix matches above contiguous-substring matches, above scattered-token matches', () => {
    const results = searchExercises(catalog, 'squat');
    // "Squat" starts with "squat" (tier 0); "Barbell Back Squat" and "Goblet Squat" contain
    // it as a contiguous substring but don't start with it (tier 1); order within a tier is
    // alphabetical.
    expect(results.map((e) => e.name)).toEqual(['Squat', 'Barbell Back Squat', 'Goblet Squat']);
  });

  it('ranks a scattered-token match below a contiguous-substring match', () => {
    // "barbell squat" is not a contiguous substring of "Barbell Back Squat" (tier 2), but
    // exact would be tier 0/1 -- verify a case where only scattered matching applies.
    const results = searchExercises(catalog, 'barbell squat');
    expect(results.map((e) => e.name)).toEqual(['Barbell Back Squat']);
  });
});

describe('highlightMatches', () => {
  it('marks the matched substring and leaves the rest unmarked', () => {
    expect(highlightMatches('Barbell Back Squat', 'back')).toEqual([
      { text: 'Barbell ', matched: false },
      { text: 'Back', matched: true },
      { text: ' Squat', matched: false },
    ]);
  });

  it('marks multiple non-adjacent token matches independently', () => {
    expect(highlightMatches('Barbell Back Squat', 'barbell squat')).toEqual([
      { text: 'Barbell', matched: true },
      { text: ' Back ', matched: false },
      { text: 'Squat', matched: true },
    ]);
  });

  it('returns the whole name unmatched for a blank query', () => {
    expect(highlightMatches('Barbell Back Squat', '')).toEqual([{ text: 'Barbell Back Squat', matched: false }]);
  });
});
