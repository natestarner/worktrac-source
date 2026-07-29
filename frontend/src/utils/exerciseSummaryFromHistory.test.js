import { describe, expect, it } from 'vitest';
import { deriveExerciseSummaryFromHistory } from './exerciseSummaryFromHistory';

const SQUAT = 1;
const BENCH = 2;

function session(id, startedAt, entries) {
  return { id, startedAt, entries };
}

function entry(exerciseId, sets, note = null) {
  return { exerciseId, exerciseName: 'x', sets, note };
}

describe('deriveExerciseSummaryFromHistory', () => {
  it('returns null lastSession/best when there is no history at all', () => {
    expect(deriveExerciseSummaryFromHistory([], SQUAT, null)).toEqual({ lastSession: null, best: null });
    expect(deriveExerciseSummaryFromHistory(undefined, SQUAT, null)).toEqual({ lastSession: null, best: null });
  });

  it('returns null lastSession/best when the exercise was never logged', () => {
    const history = [session(1, '2026-07-20T00:00:00Z', [entry(BENCH, [{ weight: 100, reps: 5, unit: 'lb' }])])];
    expect(deriveExerciseSummaryFromHistory(history, SQUAT, null)).toEqual({ lastSession: null, best: null });
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

    expect(best).toEqual({ weight: 225, reps: 5, unit: 'lb', sessionStartedAt: '2026-07-20T00:00:00Z', est1rm: 262.5 });
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
