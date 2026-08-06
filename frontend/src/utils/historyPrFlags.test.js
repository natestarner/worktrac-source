import { describe, expect, it } from 'vitest';
import { buildHistoryPrFlags, historyPrFlagKey } from './historyPrFlags';

function session(id, startedAt, exerciseId, exerciseName, sets) {
  return { id, startedAt, endedAt: startedAt, manual: false, entries: [{ exerciseId, exerciseName, sets, note: null }] };
}

describe('buildHistoryPrFlags', () => {
  it('flags the first-ever set of an exercise as a PR', () => {
    const history = [session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }])];
    const flags = buildHistoryPrFlags(history);
    expect(flags.get(historyPrFlagKey(1, 1))).toEqual([true]);
  });

  it('does not re-flag a strict repeat of the same weight and reps', () => {
    const history = [
      session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }]),
      session(2, '2026-07-08T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }]),
    ];
    const flags = buildHistoryPrFlags(history);
    expect(flags.get(historyPrFlagKey(1, 1))).toEqual([true]);
    expect(flags.get(historyPrFlagKey(2, 1))).toEqual([false]);
  });

  it('flags multiple sets within one ramping session that each beat the running best', () => {
    const history = [
      session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 100, reps: 8, unit: 'lb' }]),
      session(2, '2026-07-08T12:00:00Z', 1, 'Bench Press', [
        { weight: 135, reps: 8, unit: 'lb' },
        { weight: 155, reps: 8, unit: 'lb' },
        { weight: 155, reps: 8, unit: 'lb' }, // repeat of the just-set best -- not a PR
        { weight: 175, reps: 8, unit: 'lb' },
      ]),
    ];
    const flags = buildHistoryPrFlags(history);
    expect(flags.get(historyPrFlagKey(2, 1))).toEqual([true, true, false, true]);
  });

  it('compares bodyweight (zero-weight) sets by rep count', () => {
    const history = [
      session(1, '2026-07-01T12:00:00Z', 1, 'Pull-Up', [{ weight: 0, reps: 8, unit: 'lb' }]),
      session(2, '2026-07-08T12:00:00Z', 1, 'Pull-Up', [{ weight: 0, reps: 6, unit: 'lb' }]),
      session(3, '2026-07-15T12:00:00Z', 1, 'Pull-Up', [{ weight: 0, reps: 10, unit: 'lb' }]),
    ];
    const flags = buildHistoryPrFlags(history);
    expect(flags.get(historyPrFlagKey(1, 1))).toEqual([true]);
    expect(flags.get(historyPrFlagKey(2, 1))).toEqual([false]);
    expect(flags.get(historyPrFlagKey(3, 1))).toEqual([true]);
  });

  it('compares mixed lb/kg sets on a common lb basis', () => {
    // 100kg ~= 220.462lb, comfortably clears a 200lb prior best.
    const history = [
      session(1, '2026-07-01T12:00:00Z', 1, 'Deadlift', [{ weight: 200, reps: 1, unit: 'lb' }]),
      session(2, '2026-07-08T12:00:00Z', 1, 'Deadlift', [{ weight: 100, reps: 1, unit: 'kg' }]),
    ];
    const flags = buildHistoryPrFlags(history);
    expect(flags.get(historyPrFlagKey(2, 1))).toEqual([true]);
  });

  it('sorts by startedAt regardless of input array order (history arrives most-recent-first)', () => {
    const history = [
      session(2, '2026-07-08T12:00:00Z', 1, 'Bench Press', [{ weight: 155, reps: 8, unit: 'lb' }]),
      session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }]),
    ];
    const flags = buildHistoryPrFlags(history);
    expect(flags.get(historyPrFlagKey(1, 1))).toEqual([true]);
    expect(flags.get(historyPrFlagKey(2, 1))).toEqual([true]);
  });

  it('a retroactively-logged session dated earlier correctly demotes a later-recorded set', () => {
    // Session 2 was recorded (created) after session 1 but is dated (startedAt) BEFORE it -- e.g.
    // logged via "Log a past workout" after the fact. The fold must still treat session 2 as
    // chronologically first regardless of which order the caller's array lists them in.
    const history = [
      session(1, '2026-07-08T12:00:00Z', 1, 'Squat', [{ weight: 135, reps: 5, unit: 'lb' }]),
      session(2, '2026-07-01T12:00:00Z', 1, 'Squat', [{ weight: 185, reps: 5, unit: 'lb' }]),
    ];
    const flags = buildHistoryPrFlags(history);
    expect(flags.get(historyPrFlagKey(2, 1))).toEqual([true]); // earlier by date -> PR
    expect(flags.get(historyPrFlagKey(1, 1))).toEqual([false]); // later by date, lower weight -> not a PR
  });

  it('tracks running bests independently per exercise', () => {
    const history = [
      {
        id: 1,
        startedAt: '2026-07-01T12:00:00Z',
        endedAt: '2026-07-01T12:00:00Z',
        manual: false,
        entries: [
          { exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: null },
          { exerciseId: 2, exerciseName: 'Squat', sets: [{ weight: 225, reps: 5, unit: 'lb' }], note: null },
        ],
      },
    ];
    const flags = buildHistoryPrFlags(history);
    expect(flags.get(historyPrFlagKey(1, 1))).toEqual([true]);
    expect(flags.get(historyPrFlagKey(1, 2))).toEqual([true]);
  });

  it('returns an empty map for empty/undefined history', () => {
    expect(buildHistoryPrFlags([]).size).toBe(0);
    expect(buildHistoryPrFlags(undefined).size).toBe(0);
  });
});
