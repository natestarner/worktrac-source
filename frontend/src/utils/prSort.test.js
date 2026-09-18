import { describe, expect, it } from 'vitest';
import { DEFAULT_PR_SORT, prSortOptions, sortPrRows } from './prSort';

const row = (name, { weight = 100, reps = 5, unit = 'lb', est1rm = 116.7, date }) => ({
  exerciseId: name.length,
  exerciseName: name,
  best: { weight, reps, unit, est1rm, sessionStartedAt: date },
});

const bench = row('Bench Press', { weight: 185, reps: 8, est1rm: 234.3, date: '2026-07-01T09:00:00Z' });
const squat = row('Squat', { weight: 315, reps: 3, est1rm: 346.5, date: '2026-08-05T09:00:00Z' });
const curl = row('Curl', { weight: 40, reps: 10, est1rm: 53.3, date: '2026-06-10T09:00:00Z' });
const names = (rows) => rows.map((r) => r.exerciseName);

describe('sortPrRows', () => {
  it('orders by newest PR first', () => {
    expect(names(sortPrRows([bench, squat, curl], 'recent'))).toEqual(['Squat', 'Bench Press', 'Curl']);
  });

  it('orders by name case-insensitively', () => {
    const lower = row('anti-rotation press', { date: '2026-01-01T09:00:00Z' });
    expect(names(sortPrRows([squat, lower, bench], 'name'))).toEqual([
      'anti-rotation press',
      'Bench Press',
      'Squat',
    ]);
  });

  it('orders by estimated 1RM, highest first', () => {
    expect(names(sortPrRows([curl, bench, squat], 'est1rm'))).toEqual(['Squat', 'Bench Press', 'Curl']);
  });

  it('normalizes est. 1RM to lb before ranking a mixed-unit history', () => {
    // 100 kg estimates to ~220 lb and genuinely outranks the 200 lb lift -- comparing the raw
    // numbers would put the 200 first.
    const metric = row('Metric Deadlift', { weight: 100, reps: 1, unit: 'kg', est1rm: 100, date: '2026-01-01T09:00:00Z' });
    const imperial = row('Imperial Deadlift', { weight: 200, reps: 1, unit: 'lb', est1rm: 200, date: '2026-01-01T09:00:00Z' });
    expect(names(sortPrRows([imperial, metric], 'est1rm'))).toEqual(['Metric Deadlift', 'Imperial Deadlift']);
  });

  it('groups bodyweight lifts last under est. 1RM and ranks them by reps', () => {
    // Epley collapses to 0 at weight 0, so without the grouping these would tie at the bottom in
    // whatever order the array happened to arrive in.
    const pullUp = row('Pull-Up', { weight: 0, reps: 14, est1rm: 0, date: '2026-08-01T09:00:00Z' });
    const pushUp = row('Push-Up', { weight: 0, reps: 40, est1rm: 0, date: '2026-08-02T09:00:00Z' });
    expect(names(sortPrRows([pullUp, curl, pushUp], 'est1rm'))).toEqual(['Curl', 'Push-Up', 'Pull-Up']);
  });

  it('breaks a same-day tie by name so the order is stable across renders', () => {
    const a = row('Zercher Squat', { date: '2026-08-05T09:00:00Z' });
    const b = row('Arnold Press', { date: '2026-08-05T09:00:00Z' });
    expect(names(sortPrRows([a, b], 'recent'))).toEqual(['Arnold Press', 'Zercher Squat']);
  });

  it('falls back to the default order for a sort key it does not recognize', () => {
    // A UI slice persisted before this control existed hydrates without a prsSort.
    expect(names(sortPrRows([bench, squat, curl], undefined))).toEqual(
      names(sortPrRows([bench, squat, curl], DEFAULT_PR_SORT)),
    );
  });

  it('does not mutate the array it was given', () => {
    const input = [bench, squat, curl];
    sortPrRows(input, 'name');
    expect(names(input)).toEqual(['Bench Press', 'Squat', 'Curl']);
  });
});

describe('sortPrRows across records', () => {
  const withMeasures = (name, { est1rm, date, heaviest, heaviestDate }) => ({
    exerciseId: name.length,
    exerciseName: name,
    best: { weight: 100, reps: 5, unit: 'lb', est1rm, sessionStartedAt: date },
    measures: {
      heaviest: heaviest == null ? null : { value: heaviest, weightLb: heaviest, reps: 1, sessionStartedAt: heaviestDate ?? date },
      sessionVolume: null,
      bestSetVolume: null,
      totalReps: null,
    },
    bodyweightOnly: heaviest == null,
    durationTracked: false,
  });

  // Arranged so est. 1RM and top weight DISAGREE: Epley rewards reps, so a lighter set for more
  // reps can out-rank a heavier single. If the sort ignored the measure this test would pass on
  // the wrong ordering.
  const reps = withMeasures('Reps Lift', { est1rm: 300, date: '2026-07-01T09:00:00Z', heaviest: 200 });
  const single = withMeasures('Single Lift', { est1rm: 250, date: '2026-07-02T09:00:00Z', heaviest: 260 });
  const bodyweight = withMeasures('Pull-Up', { est1rm: 0, date: '2026-07-03T09:00:00Z', heaviest: null });

  it('ranks on the SELECTED record, not always est. 1RM', () => {
    expect(names(sortPrRows([single, reps], 'record', 'est1rm'))).toEqual(['Reps Lift', 'Single Lift']);
    expect(names(sortPrRows([reps, single], 'record', 'heaviest'))).toEqual(['Single Lift', 'Reps Lift']);
  });

  // Not a tie at zero: a pull-up has no top weight at all, so it is unrankable on that axis rather
  // than the lowest value on it. Interleaving it would put it above any genuinely light lift.
  it('groups rows the record cannot measure last, ordered by name', () => {
    expect(names(sortPrRows([bodyweight, reps, single], 'record', 'heaviest'))).toEqual([
      'Single Lift',
      'Reps Lift',
      'Pull-Up',
    ]);
  });

  it('leaves the name sort completely independent of the record', () => {
    expect(names(sortPrRows([single, bodyweight, reps], 'name', 'heaviest'))).toEqual(
      names(sortPrRows([single, bodyweight, reps], 'name', 'est1rm')),
    );
  });

  // Unrankable rows interleave normally under "Most recent", because that sort never reads a value
  // -- it falls back to the row's own best date.
  it('interleaves unmeasurable rows under Most recent rather than sinking them', () => {
    expect(names(sortPrRows([reps, bodyweight, single], 'recent', 'heaviest'))).toEqual([
      'Pull-Up',
      'Single Lift',
      'Reps Lift',
    ]);
  });

  // The date printed on the row follows the measure, so the ordering has to as well -- otherwise
  // "Most recent" would sort by a date that is not on screen.
  it('orders Most recent by the date belonging to the selected record', () => {
    const a = withMeasures('Alpha', { est1rm: 100, date: '2026-07-01T09:00:00Z', heaviest: 100, heaviestDate: '2026-09-01T09:00:00Z' });
    const b = withMeasures('Beta', { est1rm: 100, date: '2026-08-01T09:00:00Z', heaviest: 100, heaviestDate: '2026-07-15T09:00:00Z' });
    expect(names(sortPrRows([a, b], 'recent', 'est1rm'))).toEqual(['Beta', 'Alpha']);
    expect(names(sortPrRows([a, b], 'recent', 'heaviest'))).toEqual(['Alpha', 'Beta']);
  });

  // An install predating the record picker has this persisted. Falling through to the unknown-key
  // default would silently move those people back to "Most recent".
  it('honours the legacy est1rm sort value as the record sort', () => {
    expect(names(sortPrRows([single, reps], 'est1rm', 'est1rm'))).toEqual(
      names(sortPrRows([single, reps], 'record', 'est1rm')),
    );
    expect(names(sortPrRows([single, reps], 'est1rm', 'est1rm'))).not.toEqual(
      names(sortPrRows([single, reps], DEFAULT_PR_SORT, 'est1rm')),
    );
  });
});

describe('prSortOptions', () => {
  it('names the value sort after the selected record', () => {
    expect(prSortOptions('est1rm').map((o) => o.label)).toEqual([
      'Most recent',
      'Name A–Z',
      'Best est. 1RM',
    ]);
    expect(prSortOptions('heaviest')[2].label).toBe('Heaviest weight');
    expect(prSortOptions('sessionVolume')[2].label).toBe('Most volume');
  });

  it('keeps stable values while the labels move', () => {
    expect(prSortOptions('heaviest').map((o) => o.value)).toEqual(['recent', 'name', 'record']);
  });
});
