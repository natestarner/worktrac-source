import { describe, expect, it } from 'vitest';
import shared from '../../../shared/record-rules/stats-from-history-cases.json';
import { digestSessions, exerciseRecords, exerciseTrend, historyDigests, prBoard, trendsOverview } from './statsFromHistory';

// The equivalence oracle: every snapshot the backend's StatsFromHistoryCasesTest took of a random,
// real History, and what StatsService answered for it. The fold over that History must produce the
// same answers, field for field. Regenerated on the server side whenever StatsService changes, so a
// server change can never silently leave this fold behind (docs/architecture/prs-trends-from-history.md).
//
// Run three ways, because the device combines per-month digests and the answer must not depend on
// where the months fall: the whole History as one digest; one digest per calendar month, exactly
// as the History cache holds it; and random splits.
//
// The ONE accepted difference is the Free window, and it is spelled out here rather than tolerated
// silently: the device holds only the last 90 days, so on Free
//   - a trend dot's record flag is judged against the window, not the all-time best (isPr), and
//   - a workout on the floor's DATE but before its instant is plotted by the server and is not on
//     the device (its session id was renumbered after every workout in History).

const { cases } = shared;

function forDevice(points, c) {
  if (c.plan !== 'FREE') return points;
  return points
    .filter((p) => p.sessionId <= c.history.length)
    .map(({ isPr: _isPr, ...rest }) => rest);
}

// The History cache's own shape: months keyed by the UTC 'yyyy-mm' of each workout's start (the
// server computes it the same way), each newest first.
function asSyncedCache(history) {
  const months = {};
  for (const session of history) {
    const key = session.startedAt.slice(0, 7);
    (months[key] ??= { fp: key, sessions: [] }).sessions.push(session);
  }
  return { format: 2, months, checked: {} };
}

// Deterministic "random" splits of the History, oldest run first.
function randomSplits(history, seed) {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const oldestFirst = [...history].reverse();
  const runs = [];
  let run = [];
  for (const session of oldestFirst) {
    run.push(session);
    if (next() < 0.3) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.map((r) => digestSessions([...r].reverse()));
}

const WAYS = [
  ['one digest', (c) => [digestSessions(c.history)]],
  ['a digest per month', (c) => historyDigests(asSyncedCache(c.history))],
  ['random splits', (c) => randomSplits(c.history, c.history.length + 7)],
];

describe.each(WAYS)('PRs and Trends from History (%s) equal what StatsService answers', (_way, digestsOf) => {
  it('has cases to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  describe.each(cases.map((c) => [`${c.name} (${c.plan}, ${c.zone})`, c]))('%s', (_name, c) => {
    const { zone, now, historyWindow, expected } = c;
    const digests = digestsOf(c);

    it('the PRs board', () => {
      expect(prBoard(digests)).toEqual(expected.prs);
    });

    it.each(Object.keys(expected.overview))('the overview at %s weeks', (weeks) => {
      expect(trendsOverview(digests, { weeks: Number(weeks), zone, now, hiddenSessions: historyWindow.hiddenSessions }))
        .toEqual(expected.overview[weeks]);
    });

    it.each(Object.keys(expected.exercises))('exercise %s: records', (id) => {
      expect(exerciseRecords(digests, Number(id), { zone })).toEqual(expected.exercises[id].records);
    });

    it.each(Object.keys(expected.exercises))('exercise %s: trend at every range', (id) => {
      for (const weeks of Object.keys(expected.exercises[id].trend)) {
        const points = exerciseTrend(digests, Number(id), { weeks: Number(weeks), zone, now, windowStart: historyWindow.windowStart });
        expect(forDevice(points, c), `${weeks} weeks`).toEqual(forDevice(expected.exercises[id].trend[weeks], c));
      }
    });
  });
});

describe('historyDigests', () => {
  const c = cases.find((x) => x.history.length > 10);
  const cache = asSyncedCache(c.history);

  it('refolds nothing for a month the sync left alone', () => {
    const before = historyDigests(cache);
    const newest = Object.keys(cache.months).sort().at(-1);
    const next = { ...cache, months: { ...cache.months, [newest]: { ...cache.months[newest] } } };
    const after = historyDigests(next);
    expect(after.at(-1)).not.toBe(before.at(-1));
    expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
    after.slice(0, -1).forEach((digest, i) => expect(digest).toBe(before[i]));
  });

  // The workout in progress, with a set that has not synced: its copy replaces History's (never
  // joins it), lands in its own month in order, and only that month is refolded.
  const newest = c.history[0];
  const extra = { weight: 999, reps: 3, durationSeconds: null, unit: 'lb' };
  const liveCopy = {
    ...newest,
    entries: newest.entries.map((e, i) => (i === 0 ? { ...e, sets: [...e.sets, extra] } : e)),
  };

  it('folds the live workout in place of its synced copy, exactly as if History held it', () => {
    const expected = prBoard([digestSessions([liveCopy, ...c.history.slice(1)])]);
    expect(prBoard(historyDigests(cache, { live: liveCopy }))).toEqual(expected);
    expect(prBoard(historyDigests(c.history, { live: liveCopy }))).toEqual(expected);
  });

  it('folds a live workout with no id yet (offline) as the newest workout', () => {
    const offline = { id: null, startedAt: null, entries: [{ exerciseId: 99999, exerciseName: 'New Lift', sets: [extra] }] };
    const rows = prBoard(historyDigests(cache, { live: offline }));
    expect(rows.find((r) => r.exerciseId === 99999)?.best).toMatchObject({ weight: 999, reps: 3, sessionStartedAt: null });
    expect(rows.filter((r) => r.exerciseId !== 99999)).toEqual(c.expected.prs);
  });

  it('refolds only the live workout\'s month', () => {
    const before = historyDigests(cache);
    const after = historyDigests(cache, { live: liveCopy });
    const liveMonth = Object.keys(cache.months).sort().indexOf(newest.startedAt.slice(0, 7));
    after.forEach((digest, i) => (i === liveMonth ? expect(digest).not.toBe(before[i]) : expect(digest).toBe(before[i])));
  });

  it('reads a History cached by a build from before the month sync (a plain array)', () => {
    expect(prBoard(historyDigests(c.history))).toEqual(c.expected.prs);
  });

  it('is empty, not a failure, for no History at all', () => {
    expect(historyDigests(undefined)).toEqual([]);
    expect(prBoard(historyDigests(null))).toEqual([]);
  });
});
