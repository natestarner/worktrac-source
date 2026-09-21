import { describe, expect, it } from 'vitest';
import { deriveExerciseSummaryFromHistory, mergeBestWithLocalSets } from './exerciseSummaryFromHistory';
import { comparableLb } from './formulas';

const SQUAT = 1;
const BENCH = 2;

function session(id, startedAt, entries) {
  return { id, startedAt, entries };
}

function entry(exerciseId, sets, note = null) {
  return { exerciseId, exerciseName: 'x', sets, note };
}

describe('deriveExerciseSummaryFromHistory', () => {
  // null rather than 0 on every measure: prDetection reads null as "no prior best on this
  // measure" and 0 as a genuine record of zero, and those are different answers for a bodyweight
  // lift -- a 0 would make the first weighted set look like it beat something.
  const EMPTY = { lastSession: null, best: null, heaviestWeightLb: null, bestSessionVolumeLb: null };

  it('returns null lastSession/best when there is no history at all', () => {
    expect(deriveExerciseSummaryFromHistory([], SQUAT, null)).toEqual(EMPTY);
    expect(deriveExerciseSummaryFromHistory(undefined, SQUAT, null)).toEqual(EMPTY);
  });

  it('returns null lastSession/best when the exercise was never logged', () => {
    const history = [session(1, '2026-07-20T00:00:00Z', [entry(BENCH, [{ weight: 100, reps: 5, unit: 'lb' }])])];
    expect(deriveExerciseSummaryFromHistory(history, SQUAT, null)).toEqual(EMPTY);
  });

  it('picks the first (most-recent) session containing the exercise, since history is ordered most-recent-first', () => {
    const history = [
      session(3, '2026-07-27T00:00:00Z', [entry(SQUAT, [{ weight: 135, reps: 5, unit: 'lb' }], 'felt strong')]),
      session(2, '2026-07-20T00:00:00Z', [entry(SQUAT, [{ weight: 125, reps: 5, unit: 'lb' }])]),
    ];

    const { lastSession } = deriveExerciseSummaryFromHistory(history, SQUAT, null);

    expect(lastSession).toEqual({
      sessionId: 3,
      startedAt: '2026-07-27T00:00:00Z',
      sets: [{ weight: 135, reps: 5, unit: 'lb' }],
      note: 'felt strong',
    });
  });

  it('skips excludeSessionId when picking lastSession (the live/editing session), matching StatsService#getLastSession', () => {
    const history = [
      session(3, '2026-07-27T00:00:00Z', [entry(SQUAT, [{ weight: 135, reps: 5, unit: 'lb' }])]),
      session(2, '2026-07-20T00:00:00Z', [entry(SQUAT, [{ weight: 125, reps: 5, unit: 'lb' }])]),
    ];

    const { lastSession } = deriveExerciseSummaryFromHistory(history, SQUAT, 3);

    expect(lastSession.sessionId).toBe(2);
  });

  it('computes best as the max estimated 1RM across every session, never excluding one, matching StatsService#getBest', () => {
    const history = [
      // Most recent session has a lighter set...
      session(3, '2026-07-27T00:00:00Z', [entry(SQUAT, [{ weight: 100, reps: 5, unit: 'lb' }])]),
      // ...but an older session (even one that would be excluded from lastSession) has the real best.
      session(2, '2026-07-20T00:00:00Z', [entry(SQUAT, [{ weight: 225, reps: 5, unit: 'lb' }])]),
    ];

    const { best } = deriveExerciseSummaryFromHistory(history, SQUAT, 3);

    expect(best).toEqual({ weight: 225, reps: 5, durationSeconds: null, unit: 'lb', sessionStartedAt: '2026-07-20T00:00:00Z', est1rm: 262.5 });
  });

  it('compares across units when picking best, but reports the winning set in its own original unit', () => {
    const history = [
      // 140kg x5 (~360lb comparable) clearly beats 200lb x5 (~233lb comparable).
      session(1, '2026-07-27T00:00:00Z', [entry(SQUAT, [{ weight: 140, reps: 5, unit: 'kg' }])]),
      session(2, '2026-07-20T00:00:00Z', [entry(SQUAT, [{ weight: 200, reps: 5, unit: 'lb' }])]),
    ];

    const { best } = deriveExerciseSummaryFromHistory(history, SQUAT, null);

    // Assert the winner is reported in its OWN unit/weight, not converted to lb.
    expect(best.unit).toBe('kg');
    expect(best.weight).toBe(140);
  });

  it('compares bodyweight (0-weight) sets by reps directly, matching comparableLb\'s zero-weight branch', () => {
    const history = [
      session(1, '2026-07-27T00:00:00Z', [entry(SQUAT, [{ weight: 0, reps: 12, unit: 'lb' }])]),
      session(2, '2026-07-20T00:00:00Z', [entry(SQUAT, [{ weight: 0, reps: 8, unit: 'lb' }])]),
    ];

    const { best } = deriveExerciseSummaryFromHistory(history, SQUAT, null);

    expect(best.reps).toBe(12);
  });

  it('considers every set within the winning session\'s entry, not just the first', () => {
    const history = [
      session(1, '2026-07-27T00:00:00Z', [
        entry(SQUAT, [
          { weight: 95, reps: 5, unit: 'lb' },
          { weight: 135, reps: 5, unit: 'lb' },
        ]),
      ]),
    ];

    const { best } = deriveExerciseSummaryFromHistory(history, SQUAT, null);

    expect(best.weight).toBe(135);
  });
});

// `history` (and the server summary) only ever get INVALIDATED after a write, never optimistically
// written -- and invalidation is a no-op while paused/unreachable. So during an offline or lie-fi
// stretch the derived best freezes while the Log screen keeps showing newly logged sets. These
// cover the fold that reconciles the two; ExerciseDetail.test.jsx covers it end-to-end.
describe('mergeBestWithLocalSets', () => {
  const bestOf = (weight, reps, unit = 'lb') => ({ weight, reps, unit, est1rm: 171, sessionStartedAt: '2026-07-01T12:00:00Z' });

  it('returns the server best untouched when there are no local sets', () => {
    const best = bestOf(135, 8);

    expect(mergeBestWithLocalSets(best, [])).toBe(best);
    expect(mergeBestWithLocalSets(best, undefined)).toBe(best);
  });

  it('replaces the best when a local set beats it', () => {
    const merged = mergeBestWithLocalSets(bestOf(135, 8), [{ weight: 185, reps: 8, unit: 'lb' }], '2026-09-20T09:00:00Z');

    expect(merged).toEqual({ weight: 185, reps: 8, unit: 'lb', est1rm: 234.3, sessionStartedAt: '2026-09-20T09:00:00Z' });
  });

  // The Log screen's Best card renders a date. A best that came from a set which hasn't synced has
  // no SERVER session to date it by, but it does have one: the session happening right now.
  it('dates a local best by the live session it was logged into', () => {
    const merged = mergeBestWithLocalSets(null, [{ weight: 185, reps: 8, unit: 'lb' }], '2026-09-20T09:00:00Z');

    expect(merged.sessionStartedAt).toBe('2026-09-20T09:00:00Z');
  });

  // Offline the live session has no id and no startedAt for the person's whole stretch, so there
  // is nothing to date it by but now -- and an undefined date blanks the card's date line for
  // precisely the record just set.
  it('falls back to now when the live session has no start yet', () => {
    const before = Date.now();
    const merged = mergeBestWithLocalSets(null, [{ weight: 185, reps: 8, unit: 'lb' }], undefined);

    expect(Date.parse(merged.sessionStartedAt)).toBeGreaterThanOrEqual(before);
  });

  // The server best is returned AS-IS when it wins, so it keeps its own date rather than being
  // restamped with today's -- the card must say when the record was actually set.
  it('leaves the server best its own date when it wins', () => {
    const best = bestOf(225, 8);

    expect(mergeBestWithLocalSets(best, [{ weight: 185, reps: 8, unit: 'lb' }], '2026-09-20T09:00:00Z').sessionStartedAt).toBe(
      '2026-07-01T12:00:00Z',
    );
  });

  it('keeps the server best when the local set is below it', () => {
    const best = bestOf(225, 8);

    expect(mergeBestWithLocalSets(best, [{ weight: 185, reps: 8, unit: 'lb' }])).toBe(best);
  });

  it('keeps the server best when a local set exactly ties it (strict >, so the recorded one stands)', () => {
    const best = bestOf(135, 8);

    expect(mergeBestWithLocalSets(best, [{ weight: 135, reps: 8, unit: 'lb' }])).toBe(best);
  });

  it('derives a best from local sets alone when the server has none yet', () => {
    // The first-ever set for an exercise, logged offline -- otherwise the card reads "No PR yet"
    // for the whole offline stretch.
    const merged = mergeBestWithLocalSets(null, [{ weight: 100, reps: 5, unit: 'lb' }], '2026-09-20T09:00:00Z');

    expect(merged).toEqual({ weight: 100, reps: 5, unit: 'lb', est1rm: 116.7, sessionStartedAt: '2026-09-20T09:00:00Z' });
  });

  it('picks the strongest of several local sets, not the last one', () => {
    const merged = mergeBestWithLocalSets(null, [
      { weight: 135, reps: 8, unit: 'lb' },
      { weight: 185, reps: 8, unit: 'lb' },
      { weight: 95, reps: 8, unit: 'lb' },
    ]);

    expect(merged.weight).toBe(185);
  });

  it('compares a local kg set against an lb server best on the same comparable scale', () => {
    // The comparison has to go through comparableLb, never raw weight: 100kg x 5 beats 135lb x 5
    // comfortably, but a naive 100 < 135 would decide it the wrong way.
    expect(comparableLb(100, 5, 'kg')).toBeGreaterThan(comparableLb(135, 5, 'lb'));

    const merged = mergeBestWithLocalSets(bestOf(135, 5), [{ weight: 100, reps: 5, unit: 'kg' }], '2026-09-20T09:00:00Z');

    expect(merged).toEqual({ weight: 100, reps: 5, unit: 'kg', est1rm: 116.7, sessionStartedAt: '2026-09-20T09:00:00Z' });
  });

  it('ranks bodyweight sets on reps, not the collapsed Epley estimate', () => {
    // comparableLb returns reps when weight is 0; without that guard every bodyweight set would
    // tie every other one at est1rm 0.
    const merged = mergeBestWithLocalSets({ weight: 0, reps: 10, unit: 'lb', est1rm: 0 }, [{ weight: 0, reps: 12, unit: 'lb' }], '2026-09-20T09:00:00Z');

    expect(merged).toEqual({ weight: 0, reps: 12, unit: 'lb', est1rm: 0, sessionStartedAt: '2026-09-20T09:00:00Z' });
  });

  it('does not let a bodyweight local set displace a loaded server best', () => {
    const best = bestOf(135, 8); // comparable 171, vs 12 reps bodyweight -> 12
    expect(mergeBestWithLocalSets(best, [{ weight: 0, reps: 12, unit: 'lb' }])).toBe(best);
  });

  it('skips malformed local rows rather than throwing or ranking them', () => {
    const best = bestOf(135, 8);

    expect(mergeBestWithLocalSets(best, [null, undefined, {}, { weight: 185 }, { reps: 8 }])).toBe(best);
  });

  it('defaults a unitless local set to lb rather than emitting undefined into the card', () => {
    const merged = mergeBestWithLocalSets(null, [{ weight: 185, reps: 8 }]);

    expect(merged.unit).toBe('lb');
  });
});
