import { describe, expect, it } from 'vitest';
import {
  collectTagVocabulary,
  filterHistorySessions,
  filterPrRows,
  isFilterActive,
  matchesFilter,
  sessionDaySpan,
  sessionMatchesDateRange,
} from './exerciseFilter';
import { toLocalDateStr } from './datetime';

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
    endedAt: '2026-07-01T12:00:00Z',
    entries: [
      { exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }] },
      { exerciseId: 2, exerciseName: 'Squat', sets: [{ weight: 225, reps: 5, unit: 'lb' }] },
    ],
  };
  const sessionB = {
    id: 2,
    startedAt: '2026-07-08T12:00:00Z',
    endedAt: '2026-07-08T12:00:00Z',
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

  // Noon UTC, so the local day is the same in every zone a test machine realistically runs in.
  describe('by date', () => {
    it('keeps only sessions that started on the chosen day, with ALL their entries', () => {
      const result = filterHistorySessions(history, { ...noFilter, dateRange: { from: '2026-07-01', to: '2026-07-01' } }, new Map());
      expect(result).toEqual([{ session: sessionA, entries: sessionA.entries }]);
      // Not narrowed within the session: the date picks whole workouts.
      expect(result[0].entries).toBe(sessionA.entries);
    });

    it('is inclusive at both ends of a range', () => {
      const result = filterHistorySessions(history, { ...noFilter, dateRange: { from: '2026-07-01', to: '2026-07-08' } }, new Map());
      expect(result.map((r) => r.session)).toEqual([sessionB, sessionA]);
    });

    it('returns nothing for a day with no workout', () => {
      expect(filterHistorySessions(history, { ...noFilter, dateRange: { from: '2026-07-02', to: '2026-07-02' } }, new Map())).toEqual([]);
    });

    it('composes with the exercise filters: the date picks sessions, the rest narrows within them', () => {
      const filter = { ...noFilter, text: 'bench', dateRange: { from: '2026-07-01', to: '2026-07-08' } };
      expect(filterHistorySessions(history, filter, new Map())).toEqual([{ session: sessionA, entries: [sessionA.entries[0]] }]);
    });

    it('counts as an active filter on its own', () => {
      expect(isFilterActive({ ...noFilter, dateRange: { from: '2026-07-01', to: '2026-07-01' } })).toBe(true);
    });

    it('matches on the session’s LOCAL start day', () => {
      const r = { from: toLocalDateStr(sessionA.startedAt), to: toLocalDateStr(sessionA.startedAt) };
      expect(sessionMatchesDateRange(sessionA, r)).toBe(true);
      expect(sessionMatchesDateRange(sessionA, null)).toBe(true);
    });
  });
});

// Built from LOCAL wall-clock times, so "11:30 PM Friday" means that in whatever zone the tests run.
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const day = (d) => ({ from: d, to: d });

describe('sessionDaySpan / sessionMatchesDateRange: a workout counts on every day it ran across', () => {
  const lateNight = {
    startedAt: at(2026, 7, 3, 23, 30), // Fri -> Sat
    endedAt: at(2026, 7, 4, 0, 40),
    entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [] }],
  };

  it('a workout inside one day spans just that day', () => {
    expect(sessionDaySpan({ startedAt: at(2026, 7, 3, 9), endedAt: at(2026, 7, 3, 10) })).toEqual(day('2026-07-03'));
  });

  it('a workout that crosses midnight is found by searching either day, and not the days around it', () => {
    expect(sessionDaySpan(lateNight)).toEqual({ from: '2026-07-03', to: '2026-07-04' });
    expect(sessionMatchesDateRange(lateNight, day('2026-07-03'))).toBe(true);
    expect(sessionMatchesDateRange(lateNight, day('2026-07-04'))).toBe(true);
    expect(sessionMatchesDateRange(lateNight, day('2026-07-02'))).toBe(false);
    expect(sessionMatchesDateRange(lateNight, day('2026-07-05'))).toBe(false);
  });

  // The case "starts OR ends inside the range" gets wrong: a workout enclosing the whole range.
  it('a workout that spans the whole searched range is found, even though neither end is inside it', () => {
    const long = { startedAt: at(2026, 7, 3, 22), endedAt: at(2026, 7, 6, 1) };
    expect(sessionMatchesDateRange(long, { from: '2026-07-04', to: '2026-07-05' })).toBe(true);
    expect(sessionMatchesDateRange(long, day('2026-07-05'))).toBe(true);
  });

  it('an unfinished workout runs until now, so last night’s still-open workout is part of today', () => {
    const open = { startedAt: at(2026, 7, 3, 23, 30), endedAt: null };
    const now = new Date(2026, 6, 4, 1, 15).getTime();
    expect(sessionDaySpan(open, now)).toEqual({ from: '2026-07-03', to: '2026-07-04' });
    expect(sessionMatchesDateRange(open, day('2026-07-04'), now)).toBe(true);
  });

  // The server auto-closes a stale workout only when that person's live workout is next READ, and
  // History returns endedAt as stored -- so a forgotten one can sit "in progress" for weeks.
  it('an unfinished workout left open for weeks spreads no further than 8 hours past its start', () => {
    const forgotten = { startedAt: at(2026, 7, 3, 9), endedAt: null };
    const threeWeeksLater = new Date(2026, 6, 24, 12).getTime();
    expect(sessionDaySpan(forgotten, threeWeeksLater)).toEqual(day('2026-07-03'));
    expect(sessionMatchesDateRange(forgotten, day('2026-07-10'), threeWeeksLater)).toBe(false);
  });

  it('never produces a backwards span from an end stamped before the start', () => {
    expect(sessionDaySpan({ startedAt: at(2026, 7, 4, 9), endedAt: at(2026, 7, 3, 9) })).toEqual(day('2026-07-04'));
  });

  it('filterHistorySessions uses the same rule', () => {
    const result = filterHistorySessions([lateNight], { ...noFilter, dateRange: day('2026-07-04') }, new Map());
    expect(result.map((r) => r.session)).toEqual([lateNight]);
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

  it('ignores a date range -- a PR row has no session to date', () => {
    expect(filterPrRows(prs, { ...noFilter, dateRange: { from: '2026-07-01', to: '2026-07-01' } }, new Map())).toBe(prs);
  });
});
