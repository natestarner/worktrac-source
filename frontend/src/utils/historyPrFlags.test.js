import { describe, expect, it } from 'vitest';
import { buildHistoryPrFlags, historyPrFlagKey, liveSessionPrFlagKey, LIVE_SESSION_FLAG_KEY } from './historyPrFlags';

function session(id, startedAt, exerciseId, exerciseName, sets) {
  return { id, startedAt, endedAt: startedAt, manual: false, entries: [{ exerciseId, exerciseName, sets, note: null }] };
}

// The fold now returns which RECORDS each set took, not a bare boolean. `setTypes` collapses that
// back to "was this set a record at all" so the original chronology assertions stay readable --
// they are about the fold's ordering, not about which measure fell.
function setTypes(history, sessionId, exerciseId) {
  return buildHistoryPrFlags(history).setMarks.get(historyPrFlagKey(sessionId, exerciseId));
}

function wasPr(history, sessionId, exerciseId) {
  return (setTypes(history, sessionId, exerciseId) || []).map((types) => types.length > 0);
}

function sessionTypes(history, sessionId, exerciseId) {
  return buildHistoryPrFlags(history).sessionMarks.get(historyPrFlagKey(sessionId, exerciseId));
}

describe('buildHistoryPrFlags', () => {
  it('flags the first-ever set of an exercise as a PR', () => {
    const history = [session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }])];
    expect(wasPr(history, 1, 1)).toEqual([true]);
  });

  it('does not re-flag a strict repeat of the same weight and reps', () => {
    const history = [
      session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }]),
      session(2, '2026-07-08T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }]),
    ];
    expect(wasPr(history, 1, 1)).toEqual([true]);
    expect(wasPr(history, 2, 1)).toEqual([false]);
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
    expect(wasPr(history, 2, 1)).toEqual([true, true, false, true]);
  });

  it('compares bodyweight (zero-weight) sets by rep count', () => {
    const history = [
      session(1, '2026-07-01T12:00:00Z', 1, 'Pull-Up', [{ weight: 0, reps: 8, unit: 'lb' }]),
      session(2, '2026-07-08T12:00:00Z', 1, 'Pull-Up', [{ weight: 0, reps: 6, unit: 'lb' }]),
      session(3, '2026-07-15T12:00:00Z', 1, 'Pull-Up', [{ weight: 0, reps: 10, unit: 'lb' }]),
    ];
    expect(wasPr(history, 1, 1)).toEqual([true]);
    expect(wasPr(history, 2, 1)).toEqual([false]);
    expect(wasPr(history, 3, 1)).toEqual([true]);
  });

  it('compares mixed lb/kg sets on a common lb basis', () => {
    // 100kg ~= 220.462lb, comfortably clears a 200lb prior best.
    const history = [
      session(1, '2026-07-01T12:00:00Z', 1, 'Deadlift', [{ weight: 200, reps: 1, unit: 'lb' }]),
      session(2, '2026-07-08T12:00:00Z', 1, 'Deadlift', [{ weight: 100, reps: 1, unit: 'kg' }]),
    ];
    expect(wasPr(history, 2, 1)).toEqual([true]);
  });

  it('sorts by startedAt regardless of input array order (history arrives most-recent-first)', () => {
    const history = [
      session(2, '2026-07-08T12:00:00Z', 1, 'Bench Press', [{ weight: 155, reps: 8, unit: 'lb' }]),
      session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }]),
    ];
    expect(wasPr(history, 1, 1)).toEqual([true]);
    expect(wasPr(history, 2, 1)).toEqual([true]);
  });

  it('a retroactively-logged session dated earlier correctly demotes a later-recorded set', () => {
    // Session 2 was recorded (created) after session 1 but is dated (startedAt) BEFORE it -- e.g.
    // logged via "Log a past workout" after the fact. The fold must still treat session 2 as
    // chronologically first regardless of which order the caller's array lists them in.
    const history = [
      session(1, '2026-07-08T12:00:00Z', 1, 'Squat', [{ weight: 135, reps: 5, unit: 'lb' }]),
      session(2, '2026-07-01T12:00:00Z', 1, 'Squat', [{ weight: 185, reps: 5, unit: 'lb' }]),
    ];
    expect(wasPr(history, 2, 1)).toEqual([true]); // earlier by date -> PR
    expect(wasPr(history, 1, 1)).toEqual([false]); // later by date, lower weight -> not a PR
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
    expect(wasPr(history, 1, 1)).toEqual([true]);
    expect(wasPr(history, 1, 2)).toEqual([true]);
  });

  it('returns empty maps for empty/undefined history', () => {
    expect(buildHistoryPrFlags([]).setMarks.size).toBe(0);
    expect(buildHistoryPrFlags([]).sessionMarks.size).toBe(0);
    expect(buildHistoryPrFlags(undefined).setMarks.size).toBe(0);
  });

  // The whole point of the change: History could only ever say "a record happened here", never
  // which one. These are the assertions that would have caught a fold that marked the right set
  // for the wrong reason.
  describe('which record each set took', () => {
    it('names both when one set takes the top weight and the est. 1RM together', () => {
      const history = [session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }])];
      expect(setTypes(history, 1, 1)).toEqual([['heaviest', 'est1rm']]);
    });

    // Epley rewards reps, so a heavy single tops the bar and still loses the estimate. The two
    // records exist precisely because they disagree -- History has to be able to show that.
    it('names top weight alone for a heavy single that does not move the estimate', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 10, unit: 'lb' }]),
        session(2, '2026-07-08T12:00:00Z', 1, 'Bench Press', [{ weight: 155, reps: 1, unit: 'lb' }]),
      ];
      expect(setTypes(history, 2, 1)).toEqual([['heaviest']]);
    });

    it('names est. 1RM alone for more reps at a lighter load', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 155, reps: 1, unit: 'lb' }]),
        session(2, '2026-07-08T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 10, unit: 'lb' }]),
      ];
      expect(setTypes(history, 2, 1)).toEqual([['est1rm']]);
    });

    // ⚠️ A bodyweight set weighs 0, and 0 is not a top-weight record. Without the value > 0 rule
    // every pull-up in History would carry a top-weight badge.
    it('never marks top weight on a bodyweight exercise', () => {
      const history = [session(1, '2026-07-01T12:00:00Z', 1, 'Pull-Up', [{ weight: 0, reps: 10, unit: 'lb' }])];
      expect(setTypes(history, 1, 1)).toEqual([['est1rm']]);
    });

    it('marks top weight the first time load is added to a bodyweight exercise', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Pull-Up', [{ weight: 0, reps: 12, unit: 'lb' }]),
        session(2, '2026-07-08T12:00:00Z', 1, 'Pull-Up', [{ weight: 10, reps: 5, unit: 'lb' }]),
      ];
      expect(setTypes(history, 2, 1)).toContainEqual(['heaviest']);
    });

    it('matches the celebration predicate for a hold, ranking on seconds', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Plank', [{ weight: 0, reps: 0, durationSeconds: 60, unit: 'lb' }]),
        session(2, '2026-07-08T12:00:00Z', 1, 'Plank', [{ weight: 0, reps: 0, durationSeconds: 90, unit: 'lb' }]),
      ];
      expect(setTypes(history, 2, 1)).toEqual([['est1rm']]);
    });
  });

  // Session volume marks the ENTRY, not a set -- no single set is the answer.
  describe('the session-volume marker', () => {
    it('marks the session whose total beats every earlier session of that exercise', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Squat', [
          { weight: 100, reps: 10, unit: 'lb' },
          { weight: 100, reps: 10, unit: 'lb' },
        ]),
        session(2, '2026-07-08T12:00:00Z', 1, 'Squat', [
          { weight: 100, reps: 10, unit: 'lb' },
          { weight: 100, reps: 10, unit: 'lb' },
          { weight: 100, reps: 10, unit: 'lb' },
        ]),
      ];
      expect(sessionTypes(history, 1, 1)).toEqual(['sessionVolume']); // first ever
      expect(sessionTypes(history, 2, 1)).toEqual(['sessionVolume']); // beat it
    });

    it('does not mark a session that fails to beat an earlier one', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Squat', [
          { weight: 100, reps: 10, unit: 'lb' },
          { weight: 100, reps: 10, unit: 'lb' },
        ]),
        session(2, '2026-07-08T12:00:00Z', 1, 'Squat', [{ weight: 100, reps: 10, unit: 'lb' }]),
      ];
      expect(sessionTypes(history, 2, 1)).toBeUndefined();
    });

    // A hold contributes 0 volume (reps are 0), so it can never take a volume record -- again with
    // no exercise-type flag involved.
    it('never marks a hold or a bodyweight exercise', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Plank', [{ weight: 0, reps: 0, durationSeconds: 60, unit: 'lb' }]),
        session(2, '2026-07-02T12:00:00Z', 2, 'Pull-Up', [{ weight: 0, reps: 10, unit: 'lb' }]),
      ];
      expect(sessionTypes(history, 1, 1)).toBeUndefined();
      expect(sessionTypes(history, 2, 2)).toBeUndefined();
    });
  });

  // ============================================================================================
  // The live session — what makes the Log screen agree with History
  // ============================================================================================
  //
  // The workout in progress is not in `history` yet, and offline it has no server id for the
  // person's entire stretch. Both the Log screen's set rows and the "Session exercises" list fold
  // it in here rather than asking a different question, which is what the retired
  // formulas.js#isPrSet used to do.
  describe('the live session', () => {
    const liveEntry = (exerciseId, sets) => ({ exerciseId, exerciseName: 'Bench Press', sets });

    it('marks a record set in the workout in progress, against the history behind it', () => {
      const history = [session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }])];
      const { setMarks } = buildHistoryPrFlags(history, {
        liveSession: {
          id: 99,
          startedAt: '2026-07-08T12:00:00Z',
          entries: [liveEntry(1, [{ weight: 185, reps: 8, unit: 'lb' }])],
        },
      });

      // 185x8 beats both the 135 top weight and the 171 est. 1RM behind it.
      expect(setMarks.get(historyPrFlagKey(99, 1))).toEqual([['heaviest', 'est1rm']]);
    });

    // ⚠️ THE OFFLINE CASE, and the reason this feature exists. `contextSessionId` is null for the
    // person's whole outage, so the session has no id to key on -- it goes under
    // LIVE_SESSION_FLAG_KEY instead. Without this the Log screen shows no badges in exactly the
    // mode a record is most likely to go unnoticed.
    it('marks a record logged with no session id yet, under the live key', () => {
      const history = [session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }])];
      const { setMarks } = buildHistoryPrFlags(history, {
        liveSession: { id: null, startedAt: undefined, entries: [liveEntry(1, [{ weight: 185, reps: 8, unit: 'lb' }])] },
      });

      expect(setMarks.get(liveSessionPrFlagKey(null, 1))).toEqual([['heaviest', 'est1rm']]);
      expect(liveSessionPrFlagKey(null, 1)).toBe(historyPrFlagKey(LIVE_SESSION_FLAG_KEY, 1));
    });

    // A session with no startedAt must sort LAST, not become NaN and make the comparator
    // non-transitive -- it is the workout happening now, by definition after everything else.
    it('folds a dateless live session after the history behind it, not before', () => {
      const history = [session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 225, reps: 8, unit: 'lb' }])];
      const { setMarks } = buildHistoryPrFlags(history, {
        liveSession: { id: null, startedAt: undefined, entries: [liveEntry(1, [{ weight: 185, reps: 8, unit: 'lb' }])] },
      });

      // Sorted first, the 185 would look like a first-ever set and be marked.
      expect(setMarks.get(liveSessionPrFlagKey(null, 1))).toEqual([[]]);
      expect(wasPr(history, 1, 1)).toEqual([true]);
    });

    // ⚠️ Once the session syncs it is in `history` too. Folding both copies would compare the
    // session against ITSELF -- the history copy sets the running best, then the live copy fails
    // to beat it -- and every mark it had just earned would silently disappear at the moment it
    // synced.
    it('replaces the history copy of a session it has also synced, rather than folding it twice', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }]),
        session(2, '2026-07-08T12:00:00Z', 1, 'Bench Press', [{ weight: 185, reps: 8, unit: 'lb' }]),
      ];
      const { setMarks } = buildHistoryPrFlags(history, {
        liveSession: {
          id: 2,
          startedAt: '2026-07-08T12:00:00Z',
          // The merged view: the synced set plus one still queued.
          entries: [liveEntry(1, [{ weight: 185, reps: 8, unit: 'lb' }, { weight: 205, reps: 8, unit: 'lb' }])],
        },
      });

      expect(setMarks.get(historyPrFlagKey(2, 1))).toEqual([['heaviest', 'est1rm'], ['heaviest', 'est1rm']]);
    });

    // The session-level record has to see the live total too, or the "Session exercises" entry
    // header stays unbadged for the whole workout that earned it.
    it('marks the session-volume record for the workout in progress', () => {
      const history = [session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 100, reps: 5, unit: 'lb' }])];
      const { sessionMarks } = buildHistoryPrFlags(history, {
        liveSession: {
          id: null,
          startedAt: undefined,
          entries: [liveEntry(1, [{ weight: 100, reps: 10, unit: 'lb' }])],
        },
      });

      expect(sessionMarks.get(liveSessionPrFlagKey(null, 1))).toEqual(['sessionVolume']);
    });

    // The log screen asks about ONE exercise. Without the filter this is a whole-history walk on
    // the app's hottest screen, which is the objection that kept this derivation off it before.
    it('folds only the requested exercise when one is named', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }]),
        session(2, '2026-07-02T12:00:00Z', 2, 'Squat', [{ weight: 225, reps: 5, unit: 'lb' }]),
      ];
      const { setMarks } = buildHistoryPrFlags(history, { exerciseId: 1 });

      expect(setMarks.get(historyPrFlagKey(1, 1))).toEqual([['heaviest', 'est1rm']]);
      expect(setMarks.get(historyPrFlagKey(2, 2))).toBeUndefined();
    });

    // Filtering must not change the ANSWER, only the work -- the running best for an exercise is
    // unaffected by other exercises either way.
    it('gives the same answer filtered as unfiltered', () => {
      const history = [
        session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }]),
        session(2, '2026-07-02T12:00:00Z', 2, 'Squat', [{ weight: 225, reps: 5, unit: 'lb' }]),
        session(3, '2026-07-03T12:00:00Z', 1, 'Bench Press', [{ weight: 185, reps: 8, unit: 'lb' }]),
      ];
      const all = buildHistoryPrFlags(history);
      const one = buildHistoryPrFlags(history, { exerciseId: 1 });

      expect(one.setMarks.get(historyPrFlagKey(3, 1))).toEqual(all.setMarks.get(historyPrFlagKey(3, 1)));
    });

    it('is a no-op when there is no live session', () => {
      const history = [session(1, '2026-07-01T12:00:00Z', 1, 'Bench Press', [{ weight: 135, reps: 8, unit: 'lb' }])];

      expect(buildHistoryPrFlags(history, {}).setMarks).toEqual(buildHistoryPrFlags(history).setMarks);
      expect(buildHistoryPrFlags(history, { liveSession: { id: 9, entries: [] } }).setMarks.size).toBe(1);
    });
  });
});
