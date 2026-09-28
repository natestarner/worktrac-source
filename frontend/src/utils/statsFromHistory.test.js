import { describe, expect, it } from 'vitest';
import shared from '../../../shared/record-rules/stats-from-history-cases.json';
import { exerciseRecords, exerciseTrend, prBoard, trendsOverview } from './statsFromHistory';

// The equivalence oracle: every snapshot the backend's StatsFromHistoryCasesTest took of a random,
// real History, and what StatsService answered for it. The fold over that History must produce the
// same answers, field for field. Regenerated on the server side whenever StatsService changes, so a
// server change can never silently leave this fold behind (docs/architecture/prs-trends-from-history.md).
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

describe('PRs and Trends from History equal what StatsService answers', () => {
  it('has cases to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  describe.each(cases.map((c) => [`${c.name} (${c.plan}, ${c.zone})`, c]))('%s', (_name, c) => {
    const { history, zone, now, historyWindow, expected } = c;

    it('the PRs board', () => {
      expect(prBoard(history)).toEqual(expected.prs);
    });

    it.each(Object.keys(expected.overview))('the overview at %s weeks', (weeks) => {
      expect(trendsOverview(history, { weeks: Number(weeks), zone, now, hiddenSessions: historyWindow.hiddenSessions }))
        .toEqual(expected.overview[weeks]);
    });

    it.each(Object.keys(expected.exercises))('exercise %s: records', (id) => {
      expect(exerciseRecords(history, Number(id), { zone })).toEqual(expected.exercises[id].records);
    });

    it.each(Object.keys(expected.exercises))('exercise %s: trend at every range', (id) => {
      for (const weeks of Object.keys(expected.exercises[id].trend)) {
        const points = exerciseTrend(history, Number(id), { weeks: Number(weeks), zone, now, windowStart: historyWindow.windowStart });
        expect(forDevice(points, c), `${weeks} weeks`).toEqual(forDevice(expected.exercises[id].trend[weeks], c));
      }
    });
  });
});
