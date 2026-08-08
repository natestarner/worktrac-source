import { describe, expect, it } from 'vitest';
import { DEFAULT_PR_SORT, sortPrRows } from './prSort';

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
