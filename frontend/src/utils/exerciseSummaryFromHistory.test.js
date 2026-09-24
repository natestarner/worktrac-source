import { describe, expect, it } from 'vitest';
import {
  deriveExerciseSummaryFromHistory,
  mergeBestWithHistory,
  mergeBestWithLocalSets,
  mergePriorWithHistory,
} from './exerciseSummaryFromHistory';
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
  const EMPTY = { lastSession: null, best: null, heaviestWeightLb: null, bestSessionVolume: null, volumeKind: null };

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

// The offline twin of ExerciseSummaryDto's bestSessionVolume + volumeKind: the kind over EVERY
// session, the best over the earlier ones only.
describe('deriveExerciseSummaryFromHistory session volume', () => {
  it('measures a bodyweight exercise in reps and excludes the live session', () => {
    const history = [
      session(3, '2026-07-27T00:00:00Z', [entry(SQUAT, [{ weight: 0, reps: 30, unit: 'lb' }])]),
      session(2, '2026-07-20T00:00:00Z', [
        entry(SQUAT, [
          { weight: 0, reps: 8, unit: 'lb' },
          { weight: 0, reps: 8, unit: 'lb' },
        ]),
      ]),
    ];

    expect(deriveExerciseSummaryFromHistory(history, SQUAT, 3)).toMatchObject({
      volumeKind: 'reps',
      bestSessionVolume: 16,
    });
  });

  it('measures a hold in seconds', () => {
    const history = [
      session(2, '2026-07-20T00:00:00Z', [entry(SQUAT, [{ weight: 20, reps: 0, durationSeconds: 45, unit: 'lb' }])]),
    ];

    expect(deriveExerciseSummaryFromHistory(history, SQUAT, null)).toMatchObject({
      volumeKind: 'seconds',
      bestSessionVolume: 45,
    });
  });

  // One loaded set anywhere -- including in the session being excluded -- makes it pounds.
  it('decides the kind over the live session too, as the server does', () => {
    const history = [
      session(3, '2026-07-27T00:00:00Z', [entry(SQUAT, [{ weight: 10, reps: 5, unit: 'lb' }])]),
      session(2, '2026-07-20T00:00:00Z', [entry(SQUAT, [{ weight: 0, reps: 20, unit: 'lb' }])]),
    ];

    expect(deriveExerciseSummaryFromHistory(history, SQUAT, 3)).toMatchObject({
      volumeKind: 'load',
      bestSessionVolume: 0,
    });
  });
});

// #326. The server summary the celebration reads can be OUT OF DATE while its refetch is in flight
// (online: one round trip; lie-fi: the whole retry run), because its no-live-session cache entry is
// fetched before a workout and never refreshed when that workout ends. `history` is refreshed after
// every set, so the priors take the STRONGER of the two. A max can only ever raise the bar -- each
// source is at or below the true best -- so it can suppress a false record but never invent one.
describe('mergeBestWithHistory', () => {
  const best = (weight, reps, extra = {}) => ({ weight, reps, unit: 'lb', est1rm: 0, sessionStartedAt: '2026-09-01T12:00:00Z', ...extra });

  it('returns the summary best untouched when history has nothing usable', () => {
    const summaryBest = best(135, 8);

    for (const nothing of [null, undefined, {}, { weight: 'x' }, 'not an object', 42]) {
      expect(mergeBestWithHistory(summaryBest, nothing)).toBe(summaryBest);
    }
  });

  // The false "first time" record: a summary fetched before the only earlier workout.
  it('returns the history best when the summary has none', () => {
    const historyBest = best(0, 10);

    expect(mergeBestWithHistory(null, historyBest)).toBe(historyBest);
    expect(mergeBestWithHistory(undefined, historyBest)).toBe(historyBest);
  });

  it('never lets a malformed summary best beat a real history best, and never throws on one', () => {
    const historyBest = best(0, 10);

    expect(mergeBestWithHistory({}, historyBest)).toBe(historyBest);
    expect(mergeBestWithHistory({ weight: null, reps: 'x' }, historyBest)).toBe(historyBest);
  });

  it('returns null when neither side has a best, and whatever the summary held when both are unusable', () => {
    expect(mergeBestWithHistory(null, null)).toBeNull();
    expect(mergeBestWithHistory(undefined, undefined)).toBeNull();
    const malformed = {};
    expect(mergeBestWithHistory(malformed, null)).toBe(malformed);
  });

  // The realistic one: 12 reps last workout, a summary still saying 10.
  it('takes the history best when it is stronger, keeping its own date', () => {
    const stale = best(0, 10);
    const fresh = best(0, 12, { sessionStartedAt: '2026-09-20T12:00:00Z' });

    expect(mergeBestWithHistory(stale, fresh)).toBe(fresh);
  });

  // ⚠️ The Free-tier guard. `history` is window-clamped for a Free household and the summary is
  // not, so an all-time best from outside the window lives only in the summary. It must still win.
  it('keeps the summary best when it is stronger than anything history can see', () => {
    const allTime = best(225, 5);
    const insideWindow = best(185, 5);

    expect(mergeBestWithHistory(allTime, insideWindow)).toBe(allTime);
  });

  it('keeps the summary best on an exact tie (strict >, so the recorded one stands)', () => {
    const summaryBest = best(135, 8);

    expect(mergeBestWithHistory(summaryBest, best(135, 8))).toBe(summaryBest);
  });

  it('is the identity when both sides are the same object (paused or errored: summary IS derived)', () => {
    const same = best(135, 8);

    expect(mergeBestWithHistory(same, same)).toBe(same);
  });

  it('ranks on comparableValue: reps at bodyweight, seconds for a hold, pounds across units', () => {
    expect(mergeBestWithHistory(best(0, 10), best(0, 11)).reps).toBe(11);
    expect(mergeBestWithHistory(best(0, 0, { durationSeconds: 60 }), best(0, 0, { durationSeconds: 90 })).durationSeconds).toBe(90);
    // 100 kg x 5 is ~257 lb est. 1RM, well above 200 lb x 5.
    const kg = { weight: 100, reps: 5, unit: 'kg', est1rm: 116.7, sessionStartedAt: '2026-09-20T12:00:00Z' };
    expect(mergeBestWithHistory(best(200, 5), kg)).toBe(kg);
  });
});

describe('mergePriorWithHistory', () => {
  it('returns null when neither side has a value', () => {
    expect(mergePriorWithHistory(null, null)).toBeNull();
    expect(mergePriorWithHistory(undefined, undefined)).toBeNull();
    expect(mergePriorWithHistory(null, undefined)).toBeNull();
  });

  it('returns the other side when one has no value', () => {
    expect(mergePriorWithHistory(null, 10)).toBe(10);
    expect(mergePriorWithHistory(135, undefined)).toBe(135);
  });

  it('takes the higher of two values', () => {
    expect(mergePriorWithHistory(10, 12)).toBe(12);
    expect(mergePriorWithHistory(225, 185)).toBe(225);
  });

  // 0 is a genuine prior (a bodyweight lift's top weight, an all-bodyweight history read in pounds),
  // and prDetection/sessionVolume read null and 0 as different answers. Never collapse one into the
  // other.
  it('treats 0 as a real value, not as "none"', () => {
    expect(mergePriorWithHistory(0, null)).toBe(0);
    expect(mergePriorWithHistory(null, 0)).toBe(0);
    expect(mergePriorWithHistory(0, 5)).toBe(5);
  });

  // The server sends BigDecimals, which can arrive as numbers or numeric strings.
  it('accepts numeric strings and ignores anything non-numeric', () => {
    expect(mergePriorWithHistory('135.00', 100)).toBe(135);
    expect(mergePriorWithHistory('abc', 100)).toBe(100);
    expect(mergePriorWithHistory(NaN, null)).toBeNull();
    expect(mergePriorWithHistory(Infinity, 5)).toBe(5);
  });
});
