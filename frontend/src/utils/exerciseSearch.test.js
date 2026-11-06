import { describe, expect, it } from 'vitest';
import { highlightMatches, matchReason, searchExercises } from './exerciseSearch';

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

describe('a household exercise with a library name', () => {
  // The library gained "Zottman Curl" (V98) after this household had made its own.
  const catalog = [
    { id: 1, name: 'Zottman Curl', isGlobal: true, primaryMuscles: ['biceps'] },
    { id: 900, name: 'zottman curl', isGlobal: false },
    { id: 2, name: 'Spider Curl', isGlobal: true, primaryMuscles: ['biceps'] },
  ];

  it('shows the household’s own row, not both', () => {
    expect(searchExercises(catalog, 'zottman').map((e) => e.id)).toEqual([900]);
  });

  it('leaves every other library exercise alone', () => {
    expect(searchExercises(catalog, 'curl').map((e) => e.id)).toEqual([2, 900]);
  });

  it('shows the library row when the household has no twin', () => {
    expect(searchExercises(catalog.filter((e) => e.id !== 900), 'zottman').map((e) => e.id)).toEqual([1]);
  });
});

describe('searching by other names and by muscle', () => {
  const library = [
    { id: 1, name: 'Barbell Overhead Press', aliases: ['Military Press', 'OHP'], primaryMuscles: ['shoulders'] },
    { id: 2, name: 'Romanian Deadlift', aliases: ['RDL'], primaryMuscles: ['hamstrings', 'glutes'] },
    { id: 3, name: 'Cable Chest Fly', aliases: [], primaryMuscles: ['chest'] },
    { id: 4, name: 'Barbell Bench Press', aliases: ['Bench'], primaryMuscles: ['chest'] },
    { id: 5, name: 'Military Press Machine', primaryMuscles: ['shoulders'] },
    // A catalog row cached before aliases and muscles existed.
    { id: 6, name: 'Arnold Press' },
  ];

  it('finds an exercise by an abbreviation', () => {
    expect(searchExercises(library, 'ohp').map((e) => e.id)).toEqual([1]);
    expect(searchExercises(library, 'rdl').map((e) => e.id)).toEqual([2]);
  });

  it('ranks a name match above an alias match', () => {
    expect(searchExercises(library, 'military press').map((e) => e.id)).toEqual([5, 1]);
  });

  it('finds what mainly works a muscle, after anything named for it', () => {
    expect(searchExercises(library, 'chest').map((e) => e.id)).toEqual([3, 4]);
    expect(searchExercises(library, 'hamstrings').map((e) => e.id)).toEqual([2]);
  });

  it('says why a result is there when its name is not the reason', () => {
    expect(matchReason(library[0], 'ohp')).toBe('Also called OHP');
    expect(matchReason(library[3], 'chest')).toBe('Works Chest');
    expect(matchReason(library[2], 'chest')).toBeNull();
    expect(matchReason(library[5], 'arnold')).toBeNull();
  });

  it('treats a row with no aliases or muscles as matching on its name alone', () => {
    expect(searchExercises(library, 'arnold').map((e) => e.id)).toEqual([6]);
    expect(searchExercises(library, 'shoulders').map((e) => e.id)).toEqual([1, 5]);
  });
});
