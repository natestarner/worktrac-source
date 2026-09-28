import { comparableLb, comparableValue, epley, lbE7 } from './formulas';
import { setVolumeScaled, volumeScale } from './sessionVolume';

// The PRs board and Trends, derived from the History the device already holds instead of asking
// StatsService to load every set the person has logged (docs/architecture/prs-trends-from-history.md).
//
// ## Digests, one per month, combined per screen
//
// History is cached a month at a time, and a month the server did not re-send keeps its object
// across syncs (lib/historySync.js). So the work is split in two:
//
//   digestSessions(sessions)  everything about a run of workouts that does NOT depend on who is
//                             looking or when: each exercise's record candidates, each workout's
//                             totals. Memoized per month object (monthDigest), so logging a set
//                             refolds only the month it went into.
//   board / records / trend / overview
//                             combine the digests, oldest first, and do everything that DOES depend
//                             on the viewer: their time zone, today, the range.
//
// Combining must give exactly what one pass over the whole History would, however the months fall.
// statsFromHistory.test.js checks all three of: one digest for everything, one per calendar month,
// and random splits -- against the server's own answers.
//
// ## Equal, not close
//
//  - EXACT arithmetic. Pounds are integers x 1e7 (formulas.js#lbE7, sessionVolume.js), summed and
//    rounded half-up to 0.1 ONCE, as the server's BigDecimal does. Comparisons may use the measure
//    functions' doubles: each is the nearest double to an exact decimal, so they order and tie as
//    the decimals do.
//  - ONE TIE RULE, the server's too. A tie goes to the heavier load (or the record's own second
//    measure: more reps for top weight, a longer hold for heaviest load held); a full tie goes to
//    the earlier workout. Candidates are only ever replaced by something strictly better, visited
//    oldest first, so "the first one wins" IS "the earlier workout". A session total has no one
//    load, so it goes straight to the earlier workout.
//
// Each output is exactly its endpoint's DTO -- PrRowDto[], ExerciseRecordsDto,
// ExerciseTrendPointDto[], TrendsOverviewDto -- so the screens read it unchanged. The measures
// themselves are formulas.js's and sessionVolume.js's; nothing here re-derives them.

const E7 = 1e7;
const DAY_MS = 86400000;
const MAX_WEEKS = 260;
const HEATMAP_DAYS = 182;
const MAX_PR_BREAKDOWN_RUNS = 10;

// A double that is the nearest double to a decimal of at most seven places, back to that decimal x 1e7.
const toE7 = (x) => Math.round(Number(x) * E7);

// n / scale, rounded half-up to one decimal (BigDecimal#setScale(1, HALF_UP) for positive values).
// BigInt because five years of pounds x 1e7 x 20 passes 2^53.
function tenths(n, scale) {
  const t = (BigInt(n) * 20n + BigInt(scale)) / (2n * BigInt(scale));
  return Number(t) / 10;
}

const isHold = (set) => set?.durationSeconds != null;

// "Is (value, tiebreak) a better record than the incumbent?" -- StatsService#isBetter.
const isBetter = (value, tiebreak, bestValue, bestTiebreak) =>
  value > bestValue || (value === bestValue && tiebreak > bestTiebreak);

// Keep `incumbent` unless `candidate` is strictly better by (key, tiebreak): the earlier one wins a
// full tie, which is only right because candidates are always offered oldest first.
function better(incumbent, candidate, key, tiebreak) {
  if (candidate == null) return incumbent;
  if (incumbent == null) return candidate;
  return isBetter(key(candidate), tiebreak(candidate), key(incumbent), tiebreak(incumbent)) ? candidate : incumbent;
}

// A session total: only a strictly larger one replaces the earlier.
const larger = (incumbent, candidate, total) =>
  candidate == null ? incumbent : incumbent == null || total(candidate) > total(incumbent) ? candidate : incumbent;

// ── the digest: everything that does not depend on the viewer ───────────────────────────────

// One set, with the numbers every record reads precomputed once.
function item(set, session) {
  return {
    set,
    session,
    value: comparableValue(set),
    lb: lbE7(Number(set.weight) || 0, set.unit || 'lb'),
    load: setVolumeScaled(set, 'load'),
    loaded: Number(set.weight) !== 0,
  };
}

const BY_VALUE = [(i) => i.value, (i) => i.lb];
const BY_WEIGHT = [(i) => i.lb, (i) => i.set.reps];
const BY_SET_VOLUME = [(i) => i.load, (i) => i.lb];
const BY_EST1RM = [(i) => i.est, (i) => i.lb];
const BY_REPS = [(i) => i.set.reps, (i) => i.lb];
const BY_HOLD = [(i) => i.set.durationSeconds, (i) => i.lb];
const BY_LOAD_HELD = [(i) => i.lb, (i) => i.set.durationSeconds];

// `sessions` is any run of workouts, newest first (History's order). Workouts with no sets are not
// workouts to anything derived here, as the server's history drops them.
export function digestSessions(sessions) {
  const workouts = [];
  const exercises = new Map();
  for (let s = (sessions?.length ?? 0) - 1; s >= 0; s -= 1) {
    const session = sessions[s];
    const workout = { id: session.id, startedAt: session.startedAt, load: 0, sets: 0, reps: 0, hold: 0 };
    for (const entry of session.entries || []) {
      if (!entry.sets?.length) continue;
      let ex = exercises.get(entry.exerciseId);
      if (!ex) {
        ex = {
          name: entry.exerciseName, anyHold: false, anyLoaded: false,
          best: null, heaviest: null, bestSetVolume: null, bestEst1rm: null, mostReps: null, longestHold: null, heaviestLoadHeld: null,
          totalSets: 0, totalReps: 0, totalHold: 0, totalLoad: 0,
          bestSession: { load: null, reps: null, seconds: null },
          sessions: [],
        };
        exercises.set(entry.exerciseId, ex);
      }
      ex.name = entry.exerciseName;
      // This exercise in this workout: one trend point's worth.
      const point = { session, items: [], load: 0, reps: 0, hold: 0, best: null, heaviest: null, bestSetVolume: 0, bestHold: null };
      for (const set of entry.sets) {
        const it = item(set, session);
        point.items.push(it);
        point.load += it.load;
        point.reps += set.reps;
        if (isHold(set)) {
          point.hold += set.durationSeconds;
          if (point.bestHold == null || set.durationSeconds > point.bestHold) point.bestHold = set.durationSeconds;
        }
        point.best = better(point.best, it, ...BY_VALUE);
        point.heaviest = better(point.heaviest, it, ...BY_WEIGHT);
        if (it.load > point.bestSetVolume) point.bestSetVolume = it.load;

        ex.anyHold ||= isHold(set);
        ex.anyLoaded ||= it.loaded;
        ex.best = better(ex.best, it, ...BY_VALUE);
        ex.heaviest = better(ex.heaviest, it, ...BY_WEIGHT);
        ex.bestSetVolume = better(ex.bestSetVolume, it, ...BY_SET_VOLUME);
        // Bodyweight sets never take the est.-1RM record: a rep count would outrank pounds.
        if (it.loaded) ex.bestEst1rm = better(ex.bestEst1rm, { ...it, est: toE7(comparableLb(set.weight, set.reps, set.unit)) }, ...BY_EST1RM);
        ex.mostReps = better(ex.mostReps, it, ...BY_REPS);
        if (isHold(set)) {
          ex.longestHold = better(ex.longestHold, it, ...BY_HOLD);
          ex.heaviestLoadHeld = better(ex.heaviestLoadHeld, it, ...BY_LOAD_HELD);
          ex.totalHold += set.durationSeconds;
        }
        ex.totalSets += 1;
        ex.totalReps += set.reps;
        ex.totalLoad += it.load;
        workout.load += it.load;
        workout.sets += 1;
        workout.reps += set.reps;
        workout.hold += set.durationSeconds ?? 0;
      }
      ex.bestSession.load = larger(ex.bestSession.load, point, (p) => p.load);
      ex.bestSession.reps = larger(ex.bestSession.reps, point, (p) => p.reps);
      ex.bestSession.seconds = larger(ex.bestSession.seconds, point, (p) => p.hold);
      ex.sessions.push(point);
    }
    if (workout.sets > 0) workouts.push(workout);
  }
  return { workouts, exercises };
}

// ── History's cache, as digests ───────────────────────────────────────────────────────────────

// One digest per month object, and per workout left out of it (see historyDigests' `replacing`).
// A WeakMap on the month itself: a month the sync did not touch is the same object, so it is
// never refolded; a month that changed is a new object, and its old digest goes with the old month.
const monthDigests = new WeakMap();

function monthDigest(month, without) {
  let byExclusion = monthDigests.get(month);
  if (!byExclusion) {
    byExclusion = new Map();
    monthDigests.set(month, byExclusion);
  }
  const key = without ?? '';
  if (!byExclusion.has(key)) {
    const sessions = without == null ? month.sessions : month.sessions.filter((s) => s.id !== without);
    byExclusion.set(key, digestSessions(sessions));
  }
  return byExclusion.get(key);
}

const arrayDigests = new WeakMap();

// History's order: newest first by start, then id. The live workout's copy may have no id yet (the
// whole of an offline stretch); it sorts as the newest of any workouts sharing its start.
const startMs = (s) => (s.startedAt ? Date.parse(s.startedAt) : Number.POSITIVE_INFINITY);
const newestFirst = (a, b) =>
  startMs(b) - startMs(a) || (b.id == null ? 1 : a.id == null ? -1 : b.id > a.id ? 1 : b.id < a.id ? -1 : 0);

// The UTC 'yyyy-mm' a workout's month is keyed on -- the server's CONVERT(CHAR(7), started_at, 126).
const monthOf = (session) => new Date(startMs(session) === Number.POSITIVE_INFINITY ? Date.now() : startMs(session))
  .toISOString()
  .slice(0, 7);

// The digests for a History cache value, oldest first.
//
// `live` is the workout in progress as the caller holds it -- `{ id, startedAt, entries }`, with
// sets that have not synced folded in (useSessionEntries). It REPLACES History's copy of that
// workout, never joins it, or the workout would be measured against itself; and it is placed in its
// own month in order, not appended, so a tie is still decided by which workout came first. Only
// the month it lands in is refolded; every other month keeps its memoized digest.
//
// A plain array is a cache persisted by a build from before the month sync (axis D): it is one run
// of workouts, digested whole, so PRs and Trends still render until the first sync replaces it.
export function historyDigests(data, { live = null } = {}) {
  const liveId = live?.id ?? null;
  const withLive = (sessions) => [...sessions.filter((s) => liveId == null || s.id !== liveId), live].sort(newestFirst);
  if (data == null) return live ? [digestSessions([live])] : [];
  if (Array.isArray(data)) {
    if (live) return [digestSessions(withLive(data))];
    if (!arrayDigests.has(data)) arrayDigests.set(data, digestSessions(data));
    return [arrayDigests.get(data)];
  }
  if (data.months == null) return live ? [digestSessions([live])] : [];
  const liveMonth = live ? monthOf(live) : null;
  const keys = Object.keys(data.months);
  if (liveMonth && !keys.includes(liveMonth)) keys.push(liveMonth);
  return keys.sort().map((key) => {
    const month = data.months[key];
    if (key === liveMonth) return digestSessions(withLive(month?.sessions ?? []));
    // History may still hold the live workout in another month (it was moved); leave it out there.
    const holdsIt = liveId != null && month.sessions.some((s) => s.id === liveId);
    return monthDigest(month, holdsIt ? liveId : null);
  });
}

// ── dates in the viewer's zone ────────────────────────────────────────────────────────────────

const formatters = new Map();

function formatterFor(zone) {
  if (!formatters.has(zone)) {
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      // StatsService#resolveZone: an unrecognized zone is UTC rather than a failure.
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    formatters.set(zone, formatter);
  }
  return formatters.get(zone);
}

// Days since the epoch of the calendar date `instant` falls on in `zone`.
function localDay(instant, zone) {
  const parts = Object.fromEntries(formatterFor(zone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS;
}

const isoDay = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const mondayOf = (day) => day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);

// ── one exercise, combined across the digests ─────────────────────────────────────────────────

function combineExercise(digests, exerciseId) {
  let ex = null;
  for (const digest of digests) {
    const part = digest.exercises.get(exerciseId);
    if (!part) continue;
    if (!ex) {
      ex = { ...part, bestSession: { ...part.bestSession }, sessionLists: [part.sessions] };
      continue;
    }
    ex.name = part.name;
    ex.anyHold ||= part.anyHold;
    ex.anyLoaded ||= part.anyLoaded;
    ex.best = better(ex.best, part.best, ...BY_VALUE);
    ex.heaviest = better(ex.heaviest, part.heaviest, ...BY_WEIGHT);
    ex.bestSetVolume = better(ex.bestSetVolume, part.bestSetVolume, ...BY_SET_VOLUME);
    ex.bestEst1rm = better(ex.bestEst1rm, part.bestEst1rm, ...BY_EST1RM);
    ex.mostReps = better(ex.mostReps, part.mostReps, ...BY_REPS);
    ex.longestHold = better(ex.longestHold, part.longestHold, ...BY_HOLD);
    ex.heaviestLoadHeld = better(ex.heaviestLoadHeld, part.heaviestLoadHeld, ...BY_LOAD_HELD);
    ex.totalSets += part.totalSets;
    ex.totalReps += part.totalReps;
    ex.totalHold += part.totalHold;
    ex.totalLoad += part.totalLoad;
    ex.bestSession.load = larger(ex.bestSession.load, part.bestSession.load, (p) => p.load);
    ex.bestSession.reps = larger(ex.bestSession.reps, part.bestSession.reps, (p) => p.reps);
    ex.bestSession.seconds = larger(ex.bestSession.seconds, part.bestSession.seconds, (p) => p.hold);
    ex.sessionLists.push(part.sessions);
  }
  if (ex) {
    // sessionVolume.js#volumeKindOf, over every set of the exercise: seconds for a hold, reps when
    // nothing was ever loaded, pounds otherwise.
    ex.kind = ex.anyHold ? 'seconds' : ex.anyLoaded ? 'load' : 'reps';
    ex.durationTracked = ex.anyHold;
    ex.bodyweightOnly = !ex.anyLoaded;
  }
  return ex;
}

// A workout's total in the exercise's own unit (sessionVolume.js), scaled by volumeScale(kind).
const pointVolume = (point, kind) => (kind === 'seconds' ? point.hold : kind === 'reps' ? point.reps : point.load);

// ── the PRs board: GET /prs ───────────────────────────────────────────────────────────────────

function bestDto({ set, session }) {
  return {
    weight: Number(set.weight),
    reps: set.reps,
    durationSeconds: set.durationSeconds ?? null,
    unit: set.unit,
    est1rm: isHold(set) ? null : epley(set.weight, set.reps),
    sessionStartedAt: session.startedAt,
  };
}

// The work behind a session-level record: consecutive identical sets collapsed into runs, capped.
function breakdown(items) {
  const runs = [];
  for (const { set, lb } of items) {
    const weightLb = tenths(lb, E7);
    const durationSeconds = set.durationSeconds ?? null;
    const last = runs[runs.length - 1];
    if (last && last.weightLb === weightLb && last.reps === set.reps && last.durationSeconds === durationSeconds) {
      last.count += 1;
    } else if (runs.length < MAX_PR_BREAKDOWN_RUNS) {
      runs.push({ weightLb, reps: set.reps, durationSeconds, count: 1 });
    }
  }
  return runs;
}

const setMeasure = (valueScaled, scale, it) => ({
  value: tenths(valueScaled, scale),
  weightLb: tenths(it.lb, E7),
  reps: it.set.reps,
  sessionStartedAt: it.session.startedAt,
  sets: [],
  setCount: 0,
});

const sessionMeasure = (point, value) => ({
  value,
  weightLb: null,
  reps: null,
  sessionStartedAt: point.session.startedAt,
  sets: breakdown(point.items),
  setCount: point.items.length,
});

// String.CASE_INSENSITIVE_ORDER, as StatsService sorts the board.
const byNameIgnoringCase = (a, b) => {
  const x = a.exerciseName.toLowerCase();
  const y = b.exerciseName.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export function prBoard(digests) {
  const ids = new Set();
  for (const digest of digests) for (const id of digest.exercises.keys()) ids.add(id);
  const rows = [];
  for (const id of ids) {
    const ex = combineExercise(digests, id);
    const volumeSession = ex.bestSession[ex.kind];
    const noVolumeMeasure = ex.bodyweightOnly || ex.durationTracked;
    rows.push({
      exerciseId: id,
      exerciseName: ex.name,
      best: bestDto(ex.best),
      measures: {
        heaviest: ex.bodyweightOnly ? null : setMeasure(ex.heaviest.lb, E7, ex.heaviest),
        sessionVolume: sessionMeasure(volumeSession, tenths(pointVolume(volumeSession, ex.kind), volumeScale(ex.kind))),
        bestSetVolume: noVolumeMeasure ? null : setMeasure(ex.bestSetVolume.load, E7, ex.bestSetVolume),
        totalReps: ex.durationTracked ? null : sessionMeasure(ex.bestSession.reps, ex.bestSession.reps.reps),
      },
      bodyweightOnly: ex.bodyweightOnly,
      durationTracked: ex.durationTracked,
      volumeKind: ex.kind,
    });
  }
  return rows.sort(byNameIgnoringCase);
}

// ── one exercise's all-time records: GET /exercises/{id}/records ──────────────────────────────

const recordEntry = (valueScaled, scale, it, zone) => ({
  valueLb: tenths(valueScaled, scale),
  weightLb: tenths(it.lb, E7),
  reps: it.set.reps,
  durationSeconds: it.set.durationSeconds ?? null,
  date: isoDay(localDay(it.session.startedAt, zone)),
});

export function exerciseRecords(digests, exerciseId, { zone }) {
  const ex = combineExercise(digests, exerciseId);
  if (!ex) {
    return {
      bestEst1rm: null, heaviestWeight: null, bestSetVolume: null, bestSessionVolume: null, mostReps: null,
      longestHold: null, heaviestLoadHeld: null, totalSets: 0, totalReps: 0, totalHoldSeconds: 0,
      totalVolumeLb: 0, bodyweightOnly: false, durationTracked: false, volumeKind: null,
    };
  }
  const volumeSession = ex.bestSession[ex.kind];
  return {
    bestEst1rm: ex.bestEst1rm == null || ex.durationTracked ? null : recordEntry(ex.bestEst1rm.est, E7, ex.bestEst1rm, zone),
    heaviestWeight: recordEntry(ex.heaviest.lb, E7, ex.heaviest, zone),
    bestSetVolume: recordEntry(ex.bestSetVolume.load, E7, ex.bestSetVolume, zone),
    bestSessionVolume: {
      valueLb: tenths(pointVolume(volumeSession, ex.kind), volumeScale(ex.kind)),
      weightLb: null,
      reps: null,
      durationSeconds: null,
      date: isoDay(localDay(volumeSession.session.startedAt, zone)),
    },
    mostReps: ex.durationTracked ? null : recordEntry(ex.mostReps.set.reps, 1, ex.mostReps, zone),
    longestHold: ex.longestHold == null ? null : recordEntry(ex.longestHold.set.durationSeconds, 1, ex.longestHold, zone),
    heaviestLoadHeld: ex.heaviestLoadHeld == null ? null : recordEntry(ex.heaviestLoadHeld.lb, E7, ex.heaviestLoadHeld, zone),
    totalSets: ex.totalSets,
    totalReps: ex.totalReps,
    totalHoldSeconds: ex.totalHold,
    totalVolumeLb: tenths(ex.totalLoad, E7),
    bodyweightOnly: ex.bodyweightOnly,
    durationTracked: ex.durationTracked,
    volumeKind: ex.kind,
  };
}

// ── one exercise over time: GET /trends/exercises/{id} ────────────────────────────────────────

// `windowStart` is the History window's floor (null on Plus). The range is clamped to it rather than
// the sets filtered, as the server does -- but the device holds nothing behind it, so on Free a
// dot can be marked a record against the window rather than the person's all-time best. Accepted
// (docs/architecture/prs-trends-from-history.md, "Decisions"): the same gap History's badges have.
export function exerciseTrend(digests, exerciseId, { weeks, zone, now, windowStart = null }) {
  const ex = combineExercise(digests, exerciseId);
  if (!ex) return [];
  const effectiveWeeks = Math.min(Math.max(weeks, 1), MAX_WEEKS);
  let rangeStart = mondayOf(localDay(now, zone)) - 7 * (effectiveWeeks - 1);
  if (windowStart) rangeStart = Math.max(rangeStart, localDay(windowStart, zone));

  let runningBest = 0;
  const points = [];
  for (const list of ex.sessionLists) {
    for (const point of list) {
      const day = localDay(point.session.startedAt, zone);
      if (day < rangeStart) {
        runningBest = Math.max(runningBest, point.best.value);
        continue;
      }
      const isPr = point.best.value > runningBest;
      if (isPr) runningBest = point.best.value;
      points.push({
        date: isoDay(day),
        sessionId: point.session.id,
        weightLb: tenths(point.best.lb, E7),
        reps: point.best.set.reps,
        est1rmLb: tenths(toE7(point.best.value), E7),
        isPr,
        heaviestWeightLb: tenths(point.heaviest.lb, E7),
        heaviestWeightReps: point.heaviest.set.reps,
        bestSetVolumeLb: tenths(point.bestSetVolume, E7),
        sessionVolume: tenths(pointVolume(point, ex.kind), volumeScale(ex.kind)),
        volumeKind: ex.kind,
        totalReps: point.reps,
        setCount: point.items.length,
        bestHoldSeconds: point.bestHold,
        totalHoldSeconds: point.hold,
      });
    }
  }
  return points;
}

// ── Trends overview: GET /trends/overview ─────────────────────────────────────────────────────

// `hiddenSessions` is the History window's count of workouts with sets behind the Free floor: the
// overview's hasAnyHistory is all-time, so History behind the window still means this person has
// trained. (The server's count requires sets, as its History does -- WorkoutSessionRepository.)
export function trendsOverview(digests, { weeks, zone, now, hiddenSessions = 0 }) {
  const effectiveWeeks = Math.min(Math.max(weeks, 1), MAX_WEEKS);
  const today = localDay(now, zone);
  const currentWeek = mondayOf(today);
  const rangeStart = currentWeek - 7 * (effectiveWeeks - 1);

  const byWeek = new Map();
  for (let w = rangeStart; w <= currentWeek; w += 7) byWeek.set(w, { workouts: 0, volume: 0, sets: 0, reps: 0, hold: 0 });
  let thisMonth = 0;
  let lastMonth = 0;
  let anyWorkout = false;
  const days = new Map();
  for (const digest of digests) {
    for (const w of digest.workouts) {
      anyWorkout = true;
      const day = localDay(w.startedAt, zone);
      const week = byWeek.get(mondayOf(day));
      if (week) {
        week.workouts += 1;
        week.volume += w.load;
        week.sets += w.sets;
        week.reps += w.reps;
        week.hold += w.hold;
      }
      if (day >= today - 29 && day <= today) thisMonth += w.load;
      else if (day >= today - 59 && day <= today - 30) lastMonth += w.load;
      if (day >= today - (HEATMAP_DAYS - 1) && day <= today) {
        const d = days.get(day) ?? { sessionCount: 0, setCount: 0 };
        d.sessionCount += 1;
        d.setCount += w.sets;
        days.set(day, d);
      }
    }
  }

  // WeeklyStreak#consecutiveWeeks: the current week counts once trained, but an untrained one so
  // far does not break the streak.
  const trained = (w) => (byWeek.get(w)?.workouts ?? 0) > 0;
  let cursor = trained(currentWeek) ? currentWeek : currentWeek - 7;
  let streak = 0;
  while (cursor >= rangeStart && trained(cursor)) {
    streak += 1;
    cursor -= 7;
  }

  return {
    weeks: [...byWeek].map(([w, v]) => ({
      weekStart: isoDay(w),
      workoutCount: v.workouts,
      totalVolumeLb: tenths(v.volume, E7),
      totalSets: v.sets,
      totalReps: v.reps,
      totalHoldSeconds: v.hold,
    })),
    currentStreakWeeks: streak,
    workoutsThisWeek: byWeek.get(currentWeek)?.workouts ?? 0,
    workoutsLastWeek: byWeek.get(currentWeek - 7)?.workouts ?? 0,
    volumeThisMonthLb: tenths(thisMonth, E7),
    volumeLastMonthLb: tenths(lastMonth, E7),
    workoutDays: [...days].sort((a, b) => a[0] - b[0]).map(([day, d]) => ({ date: isoDay(day), ...d })),
    hasAnyHistory: anyWorkout || hiddenSessions > 0,
  };
}
