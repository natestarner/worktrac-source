import { describe, expect, it } from 'vitest';
import { collectTagVocabulary, filterHistorySessions, filterPrRows, isFilterActive, matchesFilter } from './exerciseFilter';

const chest = { id: 1, name: 'Chest' };
const back = { id: 2, name: 'Back' };

function tagMap(entries) {
  return new Map(entries);
}

const noFilter = { text: '', selectedTagIds: new Set(), exerciseFilter: null };

describe('isFilterActive', () => {
  it('is false when nothing is set', () => {
    expect(isFilterActive(noFilter)).toBe(false);
  });
  it('is true for text, tags, or an exercise filter individually', () => {
    expect(isFilterActive({ ...noFilter, text: 'bench' })).toBe(true);
    expect(isFilterActive({ ...noFilter, selectedTagIds: new Set([1]) })).toBe(true);
    expect(isFilterActive({ ...noFilter, exerciseFilter: { exerciseId: 1, exerciseName: 'Bench Press' } })).toBe(true);
  });
  it('treats whitespace-only text as inactive', () => {
    expect(isFilterActive({ ...noFilter, text: '   ' })).toBe(false);
  });
});

describe('collectTagVocabulary', () => {
  it('dedupes and sorts alphabetically across the given exercise ids', () => {
    const map = tagMap([
      [1, [chest]],
      [2, [back, chest]],
    ]);
    expect(collectTagVocabulary(map, [1, 2])).toEqual([back, chest]);
  });

  it('is empty when no exercise in the set has tags', () => {
    expect(collectTagVocabulary(new Map(), [1, 2])).toEqual([]);
  });
});

describe('matchesFilter', () => {
  const row = { exerciseId: 1, exerciseName: 'Barbell Bench Press' };

  it('matches everything when no filter is active', () => {
    expect(matchesFilter(row, noFilter, new Map())).toBe(true);
  });

  it('matches on forgiving token-based text search', () => {
    expect(matchesFilter(row, { ...noFilter, text: 'barbell bench' }, new Map())).toBe(true);
    expect(matchesFilter(row, { ...noFilter, text: 'squat' }, new Map())).toBe(false);
  });

  it('matches when the exercise has ANY of the selected tags (OR within tags)', () => {
    const map = tagMap([[1, [chest, back]]]);
    expect(matchesFilter(row, { ...noFilter, selectedTagIds: new Set([back.id]) }, map)).toBe(true);
    expect(matchesFilter(row, { ...noFilter, selectedTagIds: new Set([99]) }, map)).toBe(false);
  });

  it('excludes an untagged (e.g. soft-deleted-exercise) row from a tag filter', () => {
    expect(matchesFilter(row, { ...noFilter, selectedTagIds: new Set([chest.id]) }, new Map())).toBe(false);
  });

  it('still matches an untagged row on text alone', () => {
    expect(matchesFilter(row, { ...noFilter, text: 'bench' }, new Map())).toBe(true);
  });

  it('composes text AND tags AND exercise filter', () => {
    const map = tagMap([[1, [chest]]]);
    const filter = { text: 'bench', selectedTagIds: new Set([chest.id]), exerciseFilter: { exerciseId: 1 } };
    expect(matchesFilter(row, filter, map)).toBe(true);
    expect(matchesFilter(row, { ...filter, text: 'squat' }, map)).toBe(false);
    expect(matchesFilter(row, { ...filter, exerciseFilter: { exerciseId: 2 } }, map)).toBe(false);
  });
});

describe('filterHistorySessions', () => {
  const sessionA = {
    id: 1,
    startedAt: '2026-07-01T12:00:00Z',
    entries: [
      { exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }] },
      { exerciseId: 2, exerciseName: 'Squat', sets: [{ weight: 225, reps: 5, unit: 'lb' }] },
    ],
  };
  const sessionB = {
    id: 2,
    startedAt: '2026-07-08T12:00:00Z',
    entries: [{ exerciseId: 2, exerciseName: 'Squat', sets: [{ weight: 235, reps: 5, unit: 'lb' }] }],
  };
  const history = [sessionB, sessionA];

  it('returns every session with its original entries reference when no filter is active', () => {
    const result = filterHistorySessions(history, noFilter, new Map());
    expect(result).toEqual([
      { session: sessionB, entries: sessionB.entries },
      { session: sessionA, entries: sessionA.entries },
    ]);
    expect(result[0].entries).toBe(sessionB.entries);
  });

  it('drops non-matching entries within a session and drops sessions left with zero entries', () => {
    const filter = { ...noFilter, exerciseFilter: { exerciseId: 1 } };
    const result = filterHistorySessions(history, filter, new Map());
    // sessionB has no Bench Press entry at all -- dropped entirely.
    expect(result).toEqual([{ session: sessionA, entries: [sessionA.entries[0]] }]);
  });

  it('preserves the ORIGINAL session object reference even when its entries are filtered', () => {
    const filter = { ...noFilter, exerciseFilter: { exerciseId: 1 } };
    const [{ session }] = filterHistorySessions(history, filter, new Map());
    expect(session).toBe(sessionA);
    expect(session.entries).toHaveLength(2); // untouched -- still both entries
  });
});

describe('filterPrRows', () => {
  const prs = [
    { exerciseId: 1, exerciseName: 'Bench Press' },
    { exerciseId: 2, exerciseName: 'Squat' },
  ];

  it('returns the original array when no filter is active', () => {
    expect(filterPrRows(prs, noFilter, new Map())).toBe(prs);
  });

  it('filters by text', () => {
    expect(filterPrRows(prs, { ...noFilter, text: 'squat' }, new Map())).toEqual([prs[1]]);
  });
});
