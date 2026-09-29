import { bench, describe } from 'vitest';
import { buildHistoryPrFlags } from './historyPrFlags';
import { comparableValue, weightLb } from './formulas';
import { sessionVolume, volumeKindOf } from './sessionVolume';
import { exerciseRecords, exerciseTrend, historyDigests, prBoard, trendsOverview } from './statsFromHistory';

// What folding a five-year History costs on the device. A MEASUREMENT, run with
// `npx vitest bench src/utils/historyFold.bench.js` (never part of `npm test`): the budget for
// deriving the PRs board and Trends from the History the device already holds, instead of asking
// StatsService to load every set the person has logged.
//
// The History is the barrage account's shape: one workout a day for five years (1,827), four
// exercises a workout from a pool of 24, three sets each, one exercise done at bodyweight.
// buildHistoryPrFlags is the whole-History fold the app ALREADY runs (History badges, the Log
// screen); the other two are a rough stand-in for a PRs board + weekly-buckets fold, written with
// the real measure functions so the per-set work is representative. They are not the design.

const WORKOUTS = 1827;
const POOL = 24;

function fiveYearHistory() {
  const sessions = [];
  const today = Date.UTC(2026, 8, 28, 17);
  for (let i = 1; i <= WORKOUTS; i += 1) {
    const startedAt = new Date(today - i * 86400000).toISOString();
    const entries = [];
    for (let slot = 0; slot < 4; slot += 1) {
      const exerciseId = ((i * 4 + slot) % POOL) + 1;
      const sets = [];
      for (let s = 0; s < 3; s += 1) {
        sets.push({
          weight: exerciseId === POOL ? 0 : 45 + (i % 60) * 2.5 + s * 5,
          reps: 3 + ((i + s) % 8),
          durationSeconds: null,
          unit: 'lb',
        });
      }
      entries.push({ exerciseId, exerciseName: `Exercise ${exerciseId}`, sets, note: i % 4 === 0 && slot === 0 ? 'felt heavy' : null });
    }
    sessions.push({ id: WORKOUTS - i + 1, startedAt, endedAt: startedAt, manual: false, entries });
  }
  return sessions; // newest first, as flattenHistory returns it
}

// Per exercise: best comparable set, heaviest, best set volume, best session volume, best session reps.
function foldBoard(sessions, into = new Map()) {
  for (const session of sessions) {
    for (const entry of session.entries) {
      let row = into.get(entry.exerciseId);
      if (!row) {
        row = { best: null, bestValue: -1, heaviest: -1, bestSetVolume: -1, sessions: [] };
        into.set(entry.exerciseId, row);
      }
      let reps = 0;
      for (const set of entry.sets) {
        const value = comparableValue(set);
        if (value > row.bestValue) { row.bestValue = value; row.best = set; }
        const lb = weightLb(set);
        if (lb > row.heaviest) row.heaviest = lb;
        if (lb * set.reps > row.bestSetVolume) row.bestSetVolume = lb * set.reps;
        reps += set.reps;
      }
      row.sessions.push({ sets: entry.sets, reps, startedAt: session.startedAt });
    }
  }
  return into;
}

function finishBoard(board) {
  const rows = [];
  for (const [exerciseId, row] of board) {
    const kind = volumeKindOf(row.sessions.flatMap((s) => s.sets));
    let bestVolume = -1;
    let bestReps = -1;
    for (const s of row.sessions) {
      const v = sessionVolume(s.sets, kind);
      if (v > bestVolume) bestVolume = v;
      if (s.reps > bestReps) bestReps = s.reps;
    }
    rows.push({ exerciseId, best: row.best, heaviest: row.heaviest, bestSetVolume: row.bestSetVolume, bestVolume, bestReps });
  }
  return rows;
}

const MONDAY = (iso) => {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
};

function foldWeeks(sessions, into = new Map()) {
  for (const session of sessions) {
    const week = MONDAY(session.startedAt);
    let w = into.get(week);
    if (!w) { w = { workouts: 0, volume: 0, sets: 0, reps: 0 }; into.set(week, w); }
    w.workouts += 1;
    for (const entry of session.entries) {
      for (const set of entry.sets) {
        w.volume += weightLb(set) * set.reps;
        w.sets += 1;
        w.reps += set.reps;
      }
    }
  }
  return into;
}

const history = fiveYearHistory();
const byMonth = new Map();
for (const s of history) {
  const m = s.startedAt.slice(0, 7);
  if (!byMonth.has(m)) byMonth.set(m, []);
  byMonth.get(m).push(s);
}
// Per-month partials, as if memoized on each month's object: after a set only the current month
// is refolded, and the partials are merged.
const partials = new Map([...byMonth].map(([m, sessions]) => [m, { board: foldBoard(sessions), weeks: foldWeeks(sessions) }]));
const currentMonth = [...byMonth.keys()].sort().at(-1);

describe(`five-year History (${history.length} workouts, ${history.length * 12} sets)`, () => {
  bench('buildHistoryPrFlags (already runs today)', () => {
    buildHistoryPrFlags(history);
  });
  bench('whole-History fold: board + weekly buckets', () => {
    finishBoard(foldBoard(history));
    foldWeeks(history);
  });
  bench('one month refolded + merge of every month partial', () => {
    partials.set(currentMonth, { board: foldBoard(byMonth.get(currentMonth)), weeks: foldWeeks(byMonth.get(currentMonth)) });
    const board = new Map();
    const weeks = new Map();
    for (const p of partials.values()) {
      for (const [id, row] of p.board) {
        const into = board.get(id);
        if (!into) { board.set(id, { ...row, sessions: [...row.sessions] }); continue; }
        if (row.bestValue > into.bestValue) { into.bestValue = row.bestValue; into.best = row.best; }
        into.heaviest = Math.max(into.heaviest, row.heaviest);
        into.bestSetVolume = Math.max(into.bestSetVolume, row.bestSetVolume);
        into.sessions.push(...row.sessions);
      }
      for (const [w, v] of p.weeks) {
        const into = weeks.get(w);
        if (!into) weeks.set(w, { ...v });
        else { into.workouts += v.workouts; into.volume += v.volume; into.sets += v.sets; into.reps += v.reps; }
      }
    }
    finishBoard(board);
  });
});

// The real fold (utils/statsFromHistory.js), over the same History held the way the cache holds it.
const synced = { format: 2, months: {}, checked: {} };
for (const [m, sessions] of byMonth) synced.months[m] = { fp: m, sessions };
const digests = historyDigests(synced);
const opts = { zone: 'America/New_York', now: Date.UTC(2026, 8, 28, 20) };

describe('the real fold (statsFromHistory.js), five-year History', () => {
  bench('digest every month (a cold cache)', () => {
    historyDigests({ ...synced, months: Object.fromEntries(Object.entries(synced.months).map(([k, v]) => [k, { ...v }])) });
  });
  bench('prBoard', () => {
    prBoard(digests);
  });
  bench('trendsOverview, 12 weeks', () => {
    trendsOverview(digests, { ...opts, weeks: 12 });
  });
  bench('trendsOverview, All (260 weeks)', () => {
    trendsOverview(digests, { ...opts, weeks: 260 });
  });
  bench('exerciseTrend, All', () => {
    exerciseTrend(digests, 1, { ...opts, weeks: 260 });
  });
  bench('exerciseRecords', () => {
    exerciseRecords(digests, 1, opts);
  });
});
