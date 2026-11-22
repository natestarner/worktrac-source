import { describe, expect, it } from 'vitest';
import { historyDigests } from './statsFromHistory';
import { workoutHeadline } from './workoutHeadline';

// Every case builds a History, folds it with the SAME historyDigests the PRs board and Trends use,
// and asks for the headline of its newest workout (id 99, "today", Wednesday 14 Oct 2026). The
// fold is proven against the server elsewhere; these pin only which true thing gets said.
const NOW = Date.parse('2026-10-14T18:00:00Z');
const OPTS = { workoutId: 99, ready: true, zone: 'UTC', now: NOW };

let nextId = 1;
function workout(day, lifts, id = nextId++) {
  return {
    id,
    startedAt: `${day}T12:00:00Z`,
    endedAt: null,
    manual: false,
    entries: lifts.map(([exerciseId, exerciseName, weight, reps]) => ({
      exerciseId,
      exerciseName,
      note: null,
      sets: [{ weight, reps, durationSeconds: null, unit: 'lb' }],
    })),
  };
}
const today = (lifts) => workout('2026-10-14', lifts, 99);
const BENCH = (weight, reps = 5) => [1, 'Bench Press', weight, reps];
const SQUAT = (weight, reps = 5) => [2, 'Back Squat', weight, reps];

// History's order: newest first.
const headline = (sessions, opts = {}) => workoutHeadline(historyDigests(sessions), { ...OPTS, ...opts });

describe('workoutHeadline', () => {
  it('says nothing when History is not on this device, rather than compare against nothing', () => {
    expect(headline([today([BENCH(100)])], { ready: false })).toBeNull();
  });

  it('says nothing when the fold does not hold the workout at all', () => {
    expect(headline([workout('2026-10-13', [BENCH(100)])])).toBeNull();
  });

  it('names the starting point for the first workout ever', () => {
    expect(headline([today([BENCH(100)])])).toBe(
      'Your first workout is in. Everything from here is measured against today.',
    );
  });

  // On Free, History stops at the window: workouts behind it mean this is NOT the first.
  it('never calls it the first when the Free window hides earlier workouts', () => {
    expect(headline([today([BENCH(100)])], { hiddenSessions: 4 })).toBe('Your first workout this week.');
  });

  it('leads with a new best on an exercise done before', () => {
    expect(headline([today([BENCH(120)]), workout('2026-10-07', [BENCH(100)])])).toBe(
      'A new best on Bench Press today.',
    );
  });

  it('counts several new bests rather than naming one', () => {
    expect(
      headline([today([BENCH(120), SQUAT(200)]), workout('2026-10-07', [BENCH(100), SQUAT(180)])]),
    ).toBe('New bests on 2 exercises today.');
  });

  // A first-ever set beats nothing, so it is a baseline, not a record (the PR celebration's rule).
  it('does not count an exercise done for the first time as a new best', () => {
    expect(headline([today([BENCH(100), SQUAT(200)]), workout('2026-10-07', [BENCH(100)])])).not.toMatch(/best/);
  });

  // 130 was the best, so 120 today is no record -- but it is up on the first workout's 100.
  it('falls back to the rise since the earliest workout, dated', () => {
    expect(
      headline([today([BENCH(120)]), workout('2026-09-21', [BENCH(130)]), workout('2026-09-01', [BENCH(100)])]),
    ).toBe('Bench Press is up 20% since Sep 1.');
  });

  it('then the most workouts in a week yet, if an earlier week was trained', () => {
    expect(
      headline([today([BENCH(100)]), workout('2026-10-12', [BENCH(100)]), workout('2026-10-07', [BENCH(100)])]),
    ).toBe('2 workouts this week, your most yet.');
  });

  it('then a streak of weeks', () => {
    expect(
      headline([
        today([BENCH(100)]),
        workout('2026-10-07', [BENCH(100)]),
        workout('2026-10-05', [BENCH(100)]),
      ]),
    ).toBe('2 weeks in a row with a workout.');
  });

  // Offline, the workout has no id until its sets sync: it is folded in as the live copy, with
  // LIVE_WORKOUT_ID (null) -- the case that makes computing this at the End tap necessary.
  it('reads a workout that has not synced yet, from the live copy', () => {
    const live = { id: null, startedAt: '2026-10-14T12:00:00Z', entries: today([BENCH(120)]).entries };
    const digests = historyDigests([workout('2026-10-07', [BENCH(100)])], { live });
    expect(workoutHeadline(digests, { ...OPTS, workoutId: null })).toBe('A new best on Bench Press today.');
  });

  // formatDateLabel answers "Yesterday" for yesterday -- a heading's capital. Dated against the real
  // clock, because that is what formatDateLabel reads.
  it('writes "since yesterday" in lowercase, mid-sentence', () => {
    const local = (offsetDays, hour) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      d.setHours(hour, 0, 0, 0);
      return d.toISOString();
    };
    const at = (startedAt, weight, id) => ({ ...workout('2026-01-01', [BENCH(weight)], id), startedAt });
    const sessions = [at(local(0, 0), 120, 99), at(local(-1, 13), 130, 2), at(local(-1, 9), 100, 1)];
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(workoutHeadline(historyDigests(sessions), { ...OPTS, zone, now: Date.now() })).toBe(
      'Bench Press is up 20% since yesterday.',
    );
  });

  it('otherwise says plainly where this one falls, and never reports a drop', () => {
    expect(headline([today([BENCH(90)]), workout('2026-09-21', [BENCH(100)])])).toBe('Your first workout this week.');
  });
});
