/* The demo household: three made-up people (Alex, Sam, Jordan) and ~20 weeks of believable
 * training, written through the app's own API. The same household lives in two production accounts:
 *
 *   - the App Store REVIEWER account (account 29), seeded once on 2026-10-26 and never wiped -- App
 *     Review signs in to it, so its history stays put;
 *   - the SCREENSHOT account (account 33), wiped and re-seeded with `--replace`, the household moved
 *     forward to end last week, so the store and marketing screenshots never show empty weeks.
 *
 *   node tools/demo-household.mjs                       dry run: build the plan and print it
 *   node tools/demo-household.mjs --as-of 2026-10-26    dry run on the original calendar
 *   API=http://localhost:8080 E2E_TEST_SUPPORT_KEY=... \
 *     node tools/demo-household.mjs --register --write  register a throwaway LOCAL household
 *                                                       and seed it; prints the login
 *   API=https://api.huddle.fitness \
 *     node tools/demo-household.mjs --creds ../../screenshot_demo.txt --replace --write
 *                                                       refresh the screenshot account
 *
 * Credentials come from `--creds <file>` (REVIEWER_EMAIL= / REVIEWER_PASSWORD= lines, kept OUTSIDE
 * the repo) or DEMO_EMAIL / DEMO_PASSWORD. Never put a real account's credentials in this file or in
 * a commit, and never print them.
 *
 * --write alone refuses an account whose people already have workouts, so it cannot double up.
 * --replace empties the account first and is refused for the reviewer account anywhere, and for any
 * production account but the screenshot one (REPLACEABLE below).
 *
 * THE MODEL'S CALENDAR IS PINNED (TODAY below: Mon 26 Oct 2026) and it never reads the real date:
 * that is what keeps the tuned household identical run to run. `--as-of` (default: today in New
 * York) only moves the finished plan forward by whole weeks as it is written -- see "The calendar,
 * moved" below -- so every number, weekday and time of day is the one that was tuned.
 */
//
// Realism model, per lift: a hidden "true strength" (estimated 1RM) that grows the way real people
// do -- fast early for a novice, slow for an intermediate, with flat stretches -- plus day-to-day
// form. The reps logged on each set are what that strength allows at the weight on the bar (Epley,
// inverted), less fatigue across sets. The WEIGHT on the bar follows what a lifter actually does:
// add after a clean session (not always), repeat after missed reps, drop back ~8% after a third
// stall. Illness and a vacation knock strength down and it recovers over the following weeks.
// So plateaus, resets and setbacks emerge from the model instead of being drawn on.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
const REGISTER = process.argv.includes('--register');
const REPLACE = process.argv.includes('--replace');
const argValue = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
const CREDS = argValue('--creds');
// The record of the workouts this tool wrote for the PRIMARY person, beside the credentials file.
// The primary person can't be removed, and a Free account's History only lists the last 90 days,
// so without this record a wipe could not reach the older ones (see wipe() below).
const STATE = argValue('--state') ?? (CREDS ? CREDS.replace(/\.[^./\\]+$/, '') + '.state.json' : undefined);
const API = process.env.API;
// Production account ids, which are not secrets. The reviewer account is never wiped anywhere; on
// production only the screenshot account may be.
const REVIEWER_ACCOUNT = 29;
const REPLACEABLE = { 'api.huddle.fitness': [33] };

// ------------------------------------------------------------------ deterministic randomness
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The household was built in two passes, and reproducing it exactly means building it the same way.
// The first pass's model left a squat that climbed in a ruler-straight line; the second redid
// everything from CUTOFF with more human variation, drawn from a second stream so that everything
// before CUTOFF stayed byte-identical. One stream is shared by all three people, with a draw counter
// so the second pass can start each person at exactly the draw the first pass did.
let base = mulberry32(20261026);
let draws = 0;
const rand = () => { draws++; return base(); };
function seekStream(n) { base = mulberry32(20261026); draws = 0; while (draws < n) rand(); }
const r = (a, b) => a + (b - a) * rand();
const chance = (p) => rand() < p;
const gauss = (sd) => { const u = 1 - rand(), v = rand(); return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// From CUTOFF on: more pronounced good and bad days, an all-out last set on some days, and a test
// week at the end of the block. Seed 22 is the first of 150 tried where every barbell lift finishes
// at its best on both the est.-1RM and the top-weight chart (the check after the second pass below).
const CUTOFF = new Date(Date.UTC(2026, 6, 29)); // Wed 29 Jul, inside the Free 90-day window
let VARIATION = false; // the second-pass behaviours; off reproduces the first pass exactly
const SEED2 = Number(process.env.DEMO_SEED2 || 22); // the env override exists only to search seeds
let rand2 = mulberry32(SEED2);
const chance2 = (p) => rand2() < p;
const gauss2 = (sd) => { const u = 1 - rand2(), v = rand2(); return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ------------------------------------------------------------------ calendar (US Eastern, EDT = UTC-4 all window)
const TODAY = new Date(Date.UTC(2026, 9, 26)); // Mon 26 Oct 2026
const WEEKS = 20;
const firstMonday = new Date(TODAY.getTime() - WEEKS * 7 * 86400000); // Mon 8 Jun 2026
const dayDate = (week, dow) => new Date(firstMonday.getTime() + (week * 7 + dow) * 86400000); // dow 0 = Mon
const atLocal = (date, hour, minute) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour + 4, minute));
const SCHOOL_STARTS = new Date(Date.UTC(2026, 7, 26)); // Wed 26 Aug
const fmt = (d) => d.toISOString().slice(0, 10);

// Whole-family vacation (week of 20 Jul) and individual illnesses: days with no training, then
// strength comes back over ~3 weeks from a dip.
const VACATION = { from: new Date(Date.UTC(2026, 6, 18)), to: new Date(Date.UTC(2026, 6, 26)), dip: 0.965 };
const ILLNESS = {
  Alex: { from: new Date(Date.UTC(2026, 7, 29)), to: new Date(Date.UTC(2026, 8, 7)), dip: 0.93 },    // flu, end of Aug
  Sam: { from: new Date(Date.UTC(2026, 8, 19)), to: new Date(Date.UTC(2026, 8, 26)), dip: 0.95 },    // sick, late Sep
};

// ------------------------------------------------------------------ people and programmes
// kind: lp = fixed sets x reps, add weight on a clean session; dp = double progression in a rep
// range; bw = bodyweight for reps; hold = timed hold.
// E0 = true 1RM at the start, gain = total over the 20 weeks, tau = weeks to most of the gain
// (small = novice), flat = [fromWeek, toWeek) where strength stalls regardless.
const PEOPLE = [
  {
    name: 'Alex', sd: 0.022, startWeek: 0,
    rotation: [
      ['Barbell Back Squat', 'Romanian Deadlift', 'Leg Press', 'Standing Calf Raise', 'Plank'],
      ['Barbell Bench Press', 'Barbell Row', 'Dumbbell Lateral Raise', 'Cable Tricep Pushdown', 'Hammer Curl'],
      ['Barbell Deadlift', 'Bulgarian Split Squat', 'Seated Leg Curl', 'Hanging Knee Raise'],
      ['Barbell Overhead Press', 'Pull-up', 'Incline DB Press', 'Face Pull', 'EZ-Bar Bicep Curl'],
    ],
    lifts: {
      'Barbell Back Squat': { kind: 'lp', sets: 4, reps: 5, E0: 262, gain: 40, tau: 30, inc: 5, round: 5, rest: [150, 240] },
      'Barbell Bench Press': { kind: 'lp', sets: 4, reps: 5, E0: 204, gain: 28, tau: 30, inc: 2.5, round: 2.5, rest: [150, 220], flat: [6, 10] },
      'Barbell Deadlift': { kind: 'lp', sets: 3, reps: 5, E0: 318, gain: 36, tau: 30, inc: 10, round: 5, rest: [180, 270] },
      'Barbell Overhead Press': { kind: 'lp', sets: 4, reps: 6, E0: 131, gain: 16, tau: 30, inc: 2.5, round: 2.5, rest: [140, 200], flat: [3, 9] },
      'Barbell Row': { kind: 'dp', sets: 4, lo: 6, hi: 10, E0: 205, gain: 15, tau: 30, inc: 10, round: 5, rest: [100, 160] },
      'Romanian Deadlift': { kind: 'dp', sets: 3, lo: 8, hi: 10, E0: 255, gain: 25, tau: 30, inc: 10, round: 5, rest: [100, 160] },
      'Leg Press': { kind: 'dp', sets: 3, lo: 10, hi: 12, E0: 520, gain: 60, tau: 25, inc: 20, round: 10, rest: [90, 140] },
      'Standing Calf Raise': { kind: 'dp', sets: 3, lo: 12, hi: 15, E0: 250, gain: 30, tau: 25, inc: 10, round: 10, rest: [60, 90] },
      'Bulgarian Split Squat': { kind: 'dp', sets: 3, lo: 8, hi: 10, E0: 86, gain: 12, tau: 25, inc: 5, round: 5, rest: [90, 140] },
      'Seated Leg Curl': { kind: 'dp', sets: 3, lo: 10, hi: 12, E0: 168, gain: 18, tau: 25, inc: 10, round: 5, rest: [70, 110] },
      'Dumbbell Lateral Raise': { kind: 'dp', sets: 3, lo: 10, hi: 15, E0: 38, gain: 3, tau: 25, inc: 5, round: 5, rest: [50, 80] },
      'Cable Tricep Pushdown': { kind: 'dp', sets: 3, lo: 10, hi: 12, E0: 92, gain: 10, tau: 25, inc: 5, round: 5, rest: [50, 80] },
      'Hammer Curl': { kind: 'dp', sets: 3, lo: 8, hi: 12, E0: 52, gain: 5, tau: 25, inc: 5, round: 5, rest: [50, 80] },
      'Incline DB Press': { kind: 'dp', sets: 3, lo: 8, hi: 10, E0: 82, gain: 6, tau: 25, inc: 5, round: 5, rest: [90, 140] },
      'Face Pull': { kind: 'dp', sets: 3, lo: 12, hi: 15, E0: 82, gain: 8, tau: 25, inc: 5, round: 5, rest: [45, 75] },
      'EZ-Bar Bicep Curl': { kind: 'dp', sets: 3, lo: 8, hi: 12, E0: 96, gain: 8, tau: 25, inc: 5, round: 5, rest: [60, 90] },
      'Pull-up': { kind: 'bw', sets: 4, M0: 7, gain: 3, tau: 20, drop: 1.2, rest: [120, 180] },
      'Hanging Knee Raise': { kind: 'bw', sets: 3, M0: 11, gain: 4, tau: 20, drop: 1.5, rest: [60, 90] },
      'Plank': { kind: 'hold', sets: 3, H0: 62, gain: 25, tau: 20, drop: 9, rest: [45, 75] },
    },
  },
  {
    name: 'Sam', sd: 0.035, startWeek: 0,
    rotation: [
      ['Barbell Back Squat', 'Barbell Bench Press', 'Lat Pulldown', 'Dumbbell Bicep Curl'],
      ['Trap Bar Deadlift', 'Dumbbell Overhead Press', 'Dumbbell Row', 'Push-up'],
    ],
    lifts: {
      'Barbell Back Squat': { kind: 'lp', sets: 3, reps: 5, E0: 162, gain: 60, tau: 13, inc: 5, round: 5, rest: [120, 200] },
      'Barbell Bench Press': { kind: 'lp', sets: 3, reps: 5, E0: 137, gain: 26, tau: 10, inc: 5, round: 5, rest: [120, 180], flat: [11, 15] },
      'Trap Bar Deadlift': { kind: 'lp', sets: 3, reps: 5, E0: 218, gain: 66, tau: 9, inc: 10, round: 5, rest: [140, 210] },
      'Dumbbell Overhead Press': { kind: 'dp', sets: 3, lo: 8, hi: 10, E0: 46, gain: 9, tau: 10, inc: 5, round: 5, rest: [80, 120] },
      'Lat Pulldown': { kind: 'dp', sets: 3, lo: 8, hi: 12, E0: 142, gain: 22, tau: 10, inc: 10, round: 5, rest: [70, 110] },
      'Dumbbell Row': { kind: 'dp', sets: 3, lo: 8, hi: 12, E0: 62, gain: 12, tau: 10, inc: 5, round: 5, rest: [60, 100] },
      'Dumbbell Bicep Curl': { kind: 'dp', sets: 3, lo: 8, hi: 15, E0: 33, gain: 6, tau: 10, inc: 5, round: 5, rest: [50, 80] },
      'Push-up': { kind: 'bw', sets: 2, M0: 24, gain: 9, tau: 10, drop: 5, rest: [60, 100] },
    },
  },
  {
    // Started later than the other two -- the youngest, who joined once the others were at it.
    name: 'Jordan', sd: 0.045, startWeek: 6,
    rotation: [
      ['Dumbbell Goblet Squat', 'Dumbbell Bench Press', 'Lat Pulldown', 'Plank'],
      ['Leg Press', 'Push-up', 'Dumbbell Row', 'Dumbbell Bicep Curl'],
    ],
    lifts: {
      'Dumbbell Goblet Squat': { kind: 'dp', sets: 3, lo: 8, hi: 12, E0: 43, gain: 20, tau: 7, inc: 5, round: 5, rest: [70, 110] },
      'Dumbbell Bench Press': { kind: 'dp', sets: 3, lo: 6, hi: 12, E0: 29, gain: 9, tau: 7, inc: 2.5, round: 2.5, rest: [70, 110] },
      'Lat Pulldown': { kind: 'dp', sets: 3, lo: 8, hi: 12, E0: 82, gain: 22, tau: 8, inc: 10, round: 5, rest: [60, 100] },
      'Leg Press': { kind: 'dp', sets: 3, lo: 10, hi: 12, E0: 175, gain: 70, tau: 7, inc: 20, round: 10, rest: [70, 110] },
      'Dumbbell Row': { kind: 'dp', sets: 3, lo: 6, hi: 12, E0: 31, gain: 9, tau: 8, inc: 2.5, round: 2.5, rest: [50, 90] },
      'Dumbbell Bicep Curl': { kind: 'dp', sets: 2, lo: 6, hi: 15, E0: 21, gain: 4, tau: 8, inc: 2.5, round: 2.5, rest: [45, 70] },
      'Push-up': { kind: 'bw', sets: 3, M0: 9, gain: 8, tau: 7, drop: 2.2, rest: [50, 90] },
      'Plank': { kind: 'hold', sets: 2, H0: 32, gain: 30, tau: 8, drop: 6, rest: [40, 70] },
    },
  },
];

// ------------------------------------------------------------------ the strength curve
function progressWeeks(lift, w) {
  // Weeks of training that count toward growth: everything except the lift's flat stretch.
  if (!lift.flat) return w;
  const [a, b] = lift.flat;
  return w < a ? w : w < b ? a : w - (b - a);
}
function curve(lift, base, w, total) {
  const T = 20 - (lift.flat ? lift.flat[1] - lift.flat[0] : 0);
  const p = (1 - Math.exp(-progressWeeks(lift, w) / lift.tau)) / (1 - Math.exp(-T / lift.tau));
  return base + total * p;
}
function setbackFactor(personName, when) {
  // Multiplier on strength from the most recent layoff, recovering linearly over 21 days.
  let f = 1;
  for (const lay of [VACATION, ILLNESS[personName]].filter(Boolean)) {
    const since = (when - lay.to) / 86400000;
    if (since >= 0 && since < 21) f = Math.min(f, lay.dip + (1 - lay.dip) * (since / 21));
  }
  return f;
}
const inLayoff = (personName, d) =>
  [VACATION, ILLNESS[personName]].filter(Boolean).some((lay) => d >= lay.from && d < lay.to);
const roundTo = (x, step) => Math.round(x / step) * step;

// ------------------------------------------------------------------ schedule
function sessionDays(person, week) {
  // Which weekdays this person trains this week, varying the way real weeks do.
  if (person.name === 'Alex') {
    const base = pick([[0, 1, 3, 4], [0, 1, 3, 4], [0, 2, 4], [0, 1, 3, 5], [1, 3, 4], [0, 2, 3, 5]]);
    return base.filter(() => !chance(0.1));
  }
  if (person.name === 'Sam') {
    const base = pick([[0, 2, 4], [0, 2, 4], [0, 2, 5], [1, 3, 5], [0, 3, 5], [0, 2, 4, 5]]);
    return base.filter(() => !chance(0.12));
  }
  const base = pick([[0, 3], [1, 4], [0, 2, 5], [1, 3], [2, 5], [0, 3, 5]]);
  return base.filter(() => !chance(0.15));
}
function startTime(person, date) {
  const summer = date < SCHOOL_STARTS;
  const dow = (date.getUTCDay() + 6) % 7;
  const weekend = dow >= 5;
  if (person.name === 'Alex') {
    // Early mornings before work; weekends later.
    return weekend ? atLocal(date, 8, Math.floor(r(0, 50))) : atLocal(date, 5, Math.floor(r(35, 59)));
  }
  if (weekend) return atLocal(date, 10, Math.floor(r(0, 55)));
  return summer ? atLocal(date, 9, Math.floor(r(30, 59))) : atLocal(date, 15, Math.floor(r(40, 59)));
}

// ------------------------------------------------------------------ simulate
function simulate(person) {
  const state = {};
  for (const [name, lift] of Object.entries(person.lifts)) {
    // Start from a working weight the person would have been using: a little under what they
    // could do for the target, so the first couple of weeks are clean sessions.
    let W = null;
    if (lift.kind === 'lp') W = roundTo((lift.E0 / (1 + (lift.reps + 2) / 30)), lift.round);
    if (lift.kind === 'dp') W = roundTo(lift.E0 / (1 + (lift.hi + 1) / 30), lift.round);
    state[name] = { W, fails: 0, lowStreak: 0, history: [] };
  }
  const sessions = [];
  let rot = 0;
  for (let week = person.startWeek; week < WEEKS; week++) {
    for (const dow of sessionDays(person, week)) {
      const date = dayDate(week, dow);
      if (date >= TODAY) continue;
      if (inLayoff(person.name, date)) continue;
      const startedAt = startTime(person, date);
      const late = VARIATION && date >= CUTOFF;
      // From CUTOFF: good and bad days are more pronounced (sleep, work, a cold coming on).
      const form = 1 + gauss(person.sd) - (chance(0.05) ? 0.05 : 0) + (late ? gauss2(person.sd * 0.9) : 0);
      const factor = setbackFactor(person.name, date) * form;
      // The end of a training block: the last ~12 days are where people test what they've built.
      const testWeek = late && date >= new Date(TODAY.getTime() - 12 * 86400000);
      const wk = week + dow / 7;
      const exercises = [];
      for (const name of person.rotation[rot % person.rotation.length]) {
        const lift = person.lifts[name];
        const st = state[name];
        const sets = [];
        if (lift.kind === 'lp' || lift.kind === 'dp') {
          const E = curve(lift, lift.E0, wk, lift.gain) * factor;
          const target = lift.kind === 'lp' ? lift.reps : lift.hi;
          // Back from a layoff: a sensible lifter takes weight off the bar ONCE, the first time
          // they do this lift afterwards, then progresses normally from there.
          const layoff = [VACATION, ILLNESS[person.name]].filter(Boolean)
            .find((lay) => st.lastSeen && st.lastSeen < lay.from && date >= lay.to);
          if (layoff) {
            st.before = st.W; // what they were lifting before; strength comes back fast, so they chase it
            st.W = roundTo(st.W * (lift.kind === 'lp' ? layoff.dip - 0.02 : 0.97), lift.round);
          }
          st.lastSeen = date;
          let W = st.W;
          const fatigue = target <= 6 ? 0.45 : 0.75;
          for (let i = 0; i < lift.sets; i++) {
            let can = 30 * (E / W - 1) - fatigue * i + gauss(0.55);
            let reps = Math.max(1, Math.min(target, Math.floor(can)));
            if (lift.kind === 'dp') reps = Math.max(3, reps);
            // A set that would fall well short: real people strip a plate for the rest.
            if (lift.kind === 'lp' && reps <= target - 3 && i < lift.sets - 1) {
              sets.push({ weight: W, reps: Math.max(reps, 2) });
              W = roundTo(W * 0.9, lift.round);
              continue;
            }
            // From CUTOFF: on some days the last set of a main lift is taken to as many reps as
            // there are in the tank -- the way most real programmes run a top or final set.
            if (late && lift.kind === 'lp' && i === lift.sets - 1 && W === st.W && chance2(testWeek ? 0.85 : 0.35)) {
              reps = Math.max(reps, Math.min(target + (testWeek ? 4 : 3), Math.floor(can + gauss2(0.6))));
            }
            sets.push({ weight: W, reps });
          }
          const clean = sets.every((s) => s.reps >= target && s.weight === st.W);
          if (lift.kind === 'lp') {
            if (clean) {
              // After stalling, a lifter with small plates creeps up by 2.5 instead of 5.
              // Climbing back to a weight already owned goes in bigger jumps.
              const regaining = st.before && st.W < st.before;
              const step = regaining ? Math.max(5, lift.inc) : (st.stalls || 0) >= 2 && lift.round === 2.5 ? 2.5 : lift.inc;
              // From CUTOFF, the climb back isn't guaranteed every session either: some days the
              // weight moved slowly and they repeat it.
              // But nobody who just got two or more spare reps on the all-out set stays put.
              const surplus = late && sets[sets.length - 1].reps >= target + 2;
              const repeat = late ? !surplus && chance2(regaining ? 0.3 : 0.28) : !regaining && chance(0.22);
              if (!repeat) st.W = regaining ? Math.min(st.before, st.W + step) : st.W + step;
              st.fails = 0; st.stalls = 0;
            } else {
              st.fails = (st.fails || 0) + 1; st.stalls = (st.stalls || 0) + 1;
              if (st.fails >= 3) { st.W = roundTo(st.W * 0.92, lift.round); st.fails = 0; }
            }
          } else {
            // Double progression: earn the next weight by hitting the top of the range on every
            // set, then stay there and build reps back up. Only a weight that is clearly too
            // heavy, three times running, comes back down.
            if (sets.every((s) => s.reps >= lift.hi) && !chance(0.2)) { st.W += lift.inc; st.lowStreak = 0; }
            else if (sets[0].reps < lift.lo - 1) { st.lowStreak++; if (st.lowStreak >= 3) { st.W -= lift.inc; st.lowStreak = 0; } }
            else st.lowStreak = 0;
          }
        } else if (lift.kind === 'bw') {
          const M = curve(lift, lift.M0, wk, lift.gain) * factor;
          for (let i = 0; i < lift.sets; i++) sets.push({ weight: 0, reps: Math.max(1, Math.round(M - lift.drop * i + gauss(0.7))) });
        } else {
          const H = curve(lift, lift.H0, wk, lift.gain) * factor;
          for (let i = 0; i < lift.sets; i++) sets.push({ weight: 0, reps: 0, durationSeconds: Math.max(15, Math.round(H - lift.drop * i + gauss(4))) });
        }
        exercises.push({ name, sets });
      }
      rot++;
      sessions.push({ date, startedAt, exercises });
    }
  }
  return sessions;
}

// Pass 1 (variation off) reproduces exactly what was first written, and records where in the shared
// stream each person began. Pass 2 starts each person at that same draw, so everything before
// CUTOFF matches pass 1 session for session; only CUTOFF onwards differs.
const starts = [];
const firstPass = PEOPLE.map((p) => { starts.push(draws); return { person: p, sessions: simulate(p) }; });
let plans;
{
  VARIATION = true;
  rand2 = mulberry32(SEED2);
  plans = PEOPLE.map((p, i) => { seekStream(starts[i]); return { person: p, sessions: simulate(p) }; });
  // Prove it: every pre-CUTOFF session identical to the first pass.
  for (let i = 0; i < PEOPLE.length; i++) {
    const a = JSON.stringify(firstPass[i].sessions.filter((s) => s.date < CUTOFF));
    const b = JSON.stringify(plans[i].sessions.filter((s) => s.date < CUTOFF));
    if (a !== b) throw new Error(`${PEOPLE[i].name}: pre-cutoff history would change -- refusing`);
  }
  console.log('pre-cutoff history identical to the first pass for all three people');

  // "Ultimately keeps progressing", checked rather than eyeballed: on every barbell lift's
  // est.-1RM chart (what Trends opens on) AND its top-weight chart, the best point in the visible
  // window must be one of that lift's last two sessions -- the chart can wander, but it has to
  // finish at the top.
  const VISIBLE = new Date(Date.UTC(2026, 7, 1));
  let bad = 0;
  for (const { person, sessions } of plans) {
    for (const [name, lift] of Object.entries(person.lifts)) {
      if (lift.kind !== 'lp') continue;
      const rows = sessions.filter((s) => s.date >= VISIBLE).flatMap((s) => s.exercises.filter((e) => e.name === name));
      const e1 = rows.map((e) => Math.max(...e.sets.map((x) => Math.round(x.weight * (1 + Math.min(x.reps, 12) / 30)))));
      const top = rows.map((e) => Math.max(...e.sets.map((x) => x.weight)));
      // The best in the last two sessions, and the very last point no more than 3% under it -- a
      // chart whose final dot is a failed attempt reads as going backwards whatever came before.
      const endsHigh = (vals) => vals.slice(-2).some((v) => v >= Math.max(...vals)) && vals.at(-1) >= 0.97 * Math.max(...vals);
      const ok = endsHigh(e1) && endsHigh(top);
      if (!ok) bad++;
      console.log(`  ${ok ? 'ok  ' : 'LOW '} ${person.name} ${name}: e1RM ${e1.join(' ')} | top ${top.join(' ')}`);
    }
  }
  if (bad) throw new Error(`${bad} lift(s) finish below their peak -- the model or SEED2 changed`);
}

// ------------------------------------------------------------------ notes (a handful, tied to what happened)
function addNotes(plan) {
  const notes = [];
  const { person, sessions } = plan;
  const firstAfter = (d) => sessions.find((s) => s.date >= d);
  if (person.name === 'Alex') {
    const s1 = firstAfter(ILLNESS.Alex.to);
    if (s1) notes.push({ session: s1, exercise: s1.exercises[0].name, note: 'First one back after the flu. Took weight off and it still felt heavy.' });
    const bench = sessions.filter((s) => s.exercises[0].name === 'Barbell Bench Press');
    const stuck = bench.find((s, i) => i > 5 && s.exercises[0].sets.some((x) => x.reps < 5));
    if (stuck) notes.push({ session: stuck, exercise: 'Barbell Bench Press', note: 'Stuck here again. Last set was a grinder.' });
    const lastDl = sessions.filter((s) => s.exercises[0].name === 'Barbell Deadlift').at(-2);
    if (lastDl) notes.push({ session: lastDl, exercise: 'Barbell Deadlift', note: 'Felt fast today.' });
    const s2 = firstAfter(VACATION.to);
    if (s2) notes.push({ session: s2, exercise: s2.exercises[0].name, note: 'Back from the beach. Rusty.' });
  }
  if (person.name === 'Sam') {
    const s1 = firstAfter(ILLNESS.Sam.to);
    if (s1) notes.push({ session: s1, exercise: s1.exercises[0].name, note: 'Still getting over being sick, kept it short.' });
    const sq = sessions.filter((s) => s.exercises[0].name === 'Barbell Back Squat').at(9);
    if (sq) notes.push({ session: sq, exercise: 'Barbell Back Squat', note: 'Dad spotted. Depth was good on all of them.' });
  }
  if (person.name === 'Jordan') {
    const first25 = sessions.find((s) => s.exercises.some((e) => e.name === 'Dumbbell Bench Press' && e.sets[0].weight >= 25));
    if (first25) notes.push({ session: first25, exercise: 'Dumbbell Bench Press', note: 'First time with the 25s!' });
  }
  plan.notes = notes;
}
plans.forEach(addNotes);

// ------------------------------------------------------------------ dry-run report
const e1 = (s) => (s.durationSeconds ? 0 : s.weight * (1 + s.reps / 30));
for (const { person, sessions, notes } of plans) {
  const setCount = sessions.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
  console.log(`\n=== ${person.name}: ${sessions.length} workouts, ${setCount} sets, ${fmt(sessions[0].date)} .. ${fmt(sessions.at(-1).date)}`);
  const perWeek = {};
  for (const s of sessions) { const w = Math.floor((s.date - firstMonday) / (7 * 86400000)); perWeek[w] = (perWeek[w] || 0) + 1; }
  console.log('  workouts/week:', Array.from({ length: WEEKS }, (_, w) => perWeek[w] || 0).join(' '));
  for (const name of Object.keys(person.lifts)) {
    const rows = sessions.flatMap((s) => s.exercises.filter((e) => e.name === name).map((e) => ({ d: s.date, sets: e.sets })));
    const line = rows.map(({ d, sets }) => {
      if (sets[0].durationSeconds) return `${sets.map((x) => x.durationSeconds + 's').join('/')}`;
      if (!sets[0].weight) return sets.map((x) => x.reps).join('/');
      const ws = [...new Set(sets.map((x) => x.weight))];
      return `${ws.join('>')}x${sets.map((x) => x.reps).join('/')}`;
    });
    console.log(`  ${name}: ${line.join('  ')}`);
  }
  for (const n of notes) console.log(`  note ${fmt(n.session.date)} ${n.exercise}: ${n.note}`);
}

// ------------------------------------------------------------------ the calendar, moved
// Everything above ran on the pinned calendar, and the random streams are drawn in a fixed ORDER,
// never by date, so the plan is the same tuned household every run. Here it is moved forward by
// WHOLE WEEKS to end just before the week of `--as-of`: Monday's squat stays on a Monday, each
// week's workouts stay in one week of the charts, and every workout keeps its New York wall-clock
// time (the model wrote them as EDT, UTC-4; a shifted one in winter is written as EST, UTC-5, so a
// 5:41 AM squat is still 5:41 AM on screen).
const DAY = 86400000;
const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const nyParts = (ms) => Object.fromEntries(NY.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
// New York's offset from UTC at an instant, in ms (-4h in summer, -5h in winter).
const nyOffset = (ms) => {
  const p = nyParts(ms);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - (ms - (((ms % 1000) + 1000) % 1000));
};
// A New York wall-clock time (written as if it were UTC) back to the instant it names.
const fromWall = (wall) => { const t = wall - nyOffset(wall); return wall - nyOffset(t); };
const asOf = argValue('--as-of')
  ? new Date(`${argValue('--as-of')}T00:00:00Z`)
  : (() => { const p = nyParts(Date.now()); return new Date(Date.UTC(+p.year, +p.month - 1, +p.day)); })();
if (Number.isNaN(asOf.getTime())) throw new Error('--as-of takes a date: YYYY-MM-DD');
const anchor = new Date(asOf.getTime() - ((asOf.getUTCDay() + 6) % 7) * DAY); // that week's Monday
const SHIFT_DAYS = Math.round((anchor - TODAY) / DAY);
if (SHIFT_DAYS < 0) throw new Error(`--as-of ${fmt(asOf)} is before the household's own calendar (${fmt(TODAY)})`);
const shift = (ms) => fromWall(ms + nyOffset(ms) + SHIFT_DAYS * DAY);

// When each set is logged, decided here (before the dry-run exit) rather than in the write loop, so
// a dry run can check it. Same draws from the same stream in the same order as when the write loop
// drew them, so the times are the ones the reviewer account was written with.
for (const { person, sessions } of plans) {
  for (const s of sessions) {
    s.at = new Date(shift(s.startedAt.getTime()));
    let t = s.startedAt.getTime() + r(4, 9) * 60000; // warm-up before the first logged set
    s.writes = [];
    for (const ex of s.exercises) {
      const lift = person.lifts[ex.name];
      for (let i = 0; i < ex.sets.length; i++) {
        s.writes.push({ exercise: ex.name, i, set: ex.sets[i], original: t, loggedAt: new Date(shift(t)) });
        t += r(lift.rest[0], lift.rest[1]) * 1000;
      }
      t += r(2, 5) * 60000; // moving to the next exercise
    }
  }
}
// Prove the move, rather than trust the arithmetic: every workout and every set lands exactly
// SHIFT_DAYS later on New York's calendar, on the same weekday, at the same wall-clock minute.
for (const { person, sessions } of plans) {
  for (const s of sessions) {
    const pairs = [[s.startedAt.getTime(), s.at.getTime()], ...s.writes.map((w) => [w.original, w.loggedAt.getTime()])];
    for (const [from, to] of pairs) {
      const a = nyParts(from), b = nyParts(to);
      const days = (Date.UTC(+b.year, +b.month - 1, +b.day) - Date.UTC(+a.year, +a.month - 1, +a.day)) / DAY;
      if (days !== SHIFT_DAYS || a.weekday !== b.weekday || a.hour !== b.hour || a.minute !== b.minute) {
        throw new Error(`${person.name} ${fmt(s.date)}: moved to ${b.year}-${b.month}-${b.day} ${b.hour}:${b.minute}, not ${SHIFT_DAYS} days on at ${a.hour}:${a.minute}`);
      }
    }
    if (s.writes.at(-1).loggedAt.getTime() > Date.now()) throw new Error(`${person.name}: --as-of would write workouts in the future`);
  }
}
if (SHIFT_DAYS) {
  const nyDate = (d) => { const p = nyParts(d.getTime()); return `${p.year}-${p.month}-${p.day}`; };
  console.log(`\nmoved forward ${SHIFT_DAYS / 7} weeks (as of ${fmt(asOf)}), wall-clock times kept:`);
  for (const { person, sessions } of plans) console.log(`  ${person.name}: ${nyDate(sessions[0].at)} .. ${nyDate(sessions.at(-1).at)}`);
}

if (!WRITE) { console.log('\n(dry run -- nothing written; pass --write to perform)'); process.exit(0); }

// ------------------------------------------------------------------ write, through the app's API
if (!API) throw new Error('set API to the backend origin, e.g. API=http://localhost:8080');
const post = (path, body, headers = {}) => fetch(`${API}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

let token;
if (REGISTER) {
  // A throwaway LOCAL household. The confirmation code comes from the test-support endpoint, which
  // exists only where E2E_TEST_SUPPORT_KEY is configured -- never production.
  // The e2e prefix: the backend's no-op email pattern skips the real send, and the local e2e
  // teardown's cleanup pattern removes it with the rest of the test data.
  const email = `huddle+e2e-demo-${Date.now()}@starner.co`;
  const password = 'demo-household-1';
  const reg = await post('/api/auth/register', { email, password, personName: 'Alex' });
  if (!reg.ok) throw new Error(`register ${reg.status}: ${await reg.text()}`);
  const codeRes = await fetch(`${API}/api/auth/test/pending-code?email=${encodeURIComponent(email)}`, {
    headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
  });
  if (!codeRes.ok) throw new Error(`pending-code ${codeRes.status} -- is E2E_TEST_SUPPORT_KEY set?`);
  const { code } = await codeRes.json();
  const confirm = await post('/api/auth/confirm-email', { email, code });
  if (!confirm.ok) throw new Error(`confirm-email ${confirm.status}`);
  ({ token } = await confirm.json());
  console.log(`registered ${email} / ${password}`);
} else {
  let email = process.env.DEMO_EMAIL, password = process.env.DEMO_PASSWORD;
  if (CREDS) {
    const lines = Object.fromEntries(readFileSync(CREDS, 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
    email = lines.REVIEWER_EMAIL ?? lines.EMAIL;
    password = lines.REVIEWER_PASSWORD ?? lines.PASSWORD;
  }
  if (!email || !password) throw new Error('pass --creds <file>, set DEMO_EMAIL and DEMO_PASSWORD, or pass --register');
  const login = await post('/api/auth/login', { email, password });
  if (!login.ok) throw new Error(`login ${login.status}`);
  ({ token } = await login.json());
}
if (!token) throw new Error('no session token (a household picker? use a login with one household)');
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function call(method, path, body, attempt = 1) {
  const res = await fetch(`${API}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (res.ok) return res.status === 204 ? null : res.json();
  if (res.status >= 500 && attempt < 4) { await new Promise((ok) => setTimeout(ok, 1500 * attempt)); return call(method, path, body, attempt + 1); }
  throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

const me = await call('GET', '/api/auth/me');
const accountId = me.account?.id;
const host = new URL(API).hostname;
const primaryOf = (list) => list.find((p) => p.isPrimary ?? p.primary);

// ------------------------------------------------------------------ --replace: empty the account
// Sam and Jordan are removed (that deletes their whole history). Alex is the account's primary
// person, which the app won't remove, so his routines are deleted and every set of every workout he
// has is deleted; a workout with no sets is dropped by History, by the "older workouts hidden"
// count and by every stat (WorkoutSessionRepository's EXISTS sub-select), so it shows nowhere.
//
// Finding Alex's workouts: History lists only a Free account's last 90 days, so the older ones come
// from the record of what the last run wrote (STATE). The wipe then checks History AND the hidden
// count are both zero -- a run that can't reach something says so instead of seeding beside it.
async function wipe() {
  if (accountId === REVIEWER_ACCOUNT) throw new Error('refusing to --replace the App Store reviewer account');
  if (REPLACEABLE[host] && !REPLACEABLE[host].includes(accountId)) {
    throw new Error(`refusing to --replace account ${accountId} on ${host}: only ${REPLACEABLE[host].join(', ')} may be`);
  }
  const list = await call('GET', '/api/people');
  for (const p of list) {
    if (await call('GET', `/api/people/${p.id}/sessions/live`)) throw new Error(`${p.name} has a workout in progress -- not wiping over it`);
  }
  const primary = primaryOf(list);
  if (primary.name !== 'Alex') throw new Error(`the primary person is "${primary.name}", not Alex -- rename them first`);
  for (const p of list.filter((x) => x !== primary)) {
    await call('DELETE', `/api/people/${p.id}`);
    console.log(`removed ${p.name} and their history`);
  }
  for (const routine of await call('GET', `/api/people/${primary.id}/routines`)) {
    await call('DELETE', `/api/people/${primary.id}/routines/${routine.id}`);
  }
  const targets = new Map(); // workout id -> exercise ids in it
  const recorded = STATE && existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null;
  if (recorded && recorded.accountId !== accountId) throw new Error(`${STATE} records account ${recorded.accountId}, not ${accountId}`);
  for (const w of recorded?.workouts ?? []) targets.set(w.id, new Set(w.exerciseIds));
  for (const h of await call('GET', `/api/people/${primary.id}/history`)) {
    const ids = targets.get(h.id) ?? new Set();
    for (const e of h.entries) ids.add(e.exerciseId);
    targets.set(h.id, ids);
  }
  let deleted = 0;
  for (const [sessionId, exerciseIds] of targets) {
    for (const exerciseId of exerciseIds) {
      for (const set of await call('GET', `/api/sessions/${sessionId}/sets?exerciseId=${exerciseId}`)) {
        await call('DELETE', `/api/sets/${set.id}`);
        deleted++;
      }
    }
  }
  const left = (await call('GET', `/api/people/${primary.id}/history`)).length;
  const hidden = (await call('GET', `/api/people/${primary.id}/history-window`)).hiddenSessions ?? 0;
  if (left || hidden) {
    throw new Error(`${primary.name} still has ${left} workouts in History and ${hidden} older ones hidden after the wipe -- `
      + `the record of the last run (${STATE ?? 'none: pass --creds or --state'}) doesn't cover them. Nothing new was written.`);
  }
  console.log(`emptied ${primary.name}: ${deleted} sets deleted from ${targets.size} workouts`);
}

if (REPLACE) await wipe();
let people = await call('GET', '/api/people');
for (const p of people) {
  const h = await call('GET', `/api/people/${p.id}/history`);
  const hidden = (await call('GET', `/api/people/${p.id}/history-window`)).hiddenSessions ?? 0;
  if (h.length || hidden) throw new Error(`${p.name} already has ${h.length + hidden} workouts -- refusing to seed twice (--replace empties the account first)`);
}
for (const { person } of plans) {
  if (!people.some((p) => p.name === person.name)) await call('POST', '/api/people', { name: person.name });
}
people = await call('GET', '/api/people');
const catalog = await call('GET', '/api/exercises');
const exId = (name) => {
  const e = catalog.find((x) => x.name === name);
  if (!e) throw new Error(`catalog has no "${name}"`);
  return e.id;
};
// Fail before writing anything if a name doesn't resolve.
for (const { person } of plans) Object.keys(person.lifts).forEach(exId);

// A fresh prefix per run: an idempotency key outlives the set it created, so a key reused after a
// wipe would answer with the deleted set instead of writing a new one.
const RUN = Date.now().toString(36);
const record = { accountId, writtenAt: new Date().toISOString(), workouts: [] };
const saveRecord = () => { if (STATE) writeFileSync(STATE, JSON.stringify(record, null, 1)); };

for (const { person, sessions, notes } of plans) {
  const pid = people.find((p) => p.name === person.name).id;
  const isPrimary = pid === primaryOf(people).id;
  let n = 0;
  for (const s of sessions) {
    const created = await call('POST', `/api/people/${pid}/sessions`, { startedAt: s.at.toISOString() });
    s.id = created.id;
    // Recorded as soon as it exists, so a run that dies half-way can still be wiped next time.
    if (isPrimary) { record.workouts.push({ id: s.id, exerciseIds: [...new Set(s.exercises.map((e) => exId(e.name)))] }); saveRecord(); }
    for (const w of s.writes) {
      await call('POST', `/api/sessions/${s.id}/sets`, {
        exerciseId: exId(w.exercise), weight: w.set.weight, reps: w.set.reps,
        durationSeconds: w.set.durationSeconds,
        // Ids, not names: workout_sets.client_key is 64 characters, and "demo-household-<run>-...
        // -Dumbbell Overhead Press-0" was over it (the backend answers that with a 503).
        idempotencyKey: `dh-${RUN}-${s.id}-${exId(w.exercise)}-${w.i}`,
        clientLoggedAt: w.loggedAt.toISOString(),
      });
      n++;
    }
  }
  for (const nt of notes) {
    await call('PUT', `/api/sessions/${nt.session.id}/exercises/${exId(nt.exercise)}/note`, { note: nt.note });
  }
  // Their programme, as routines.
  // Named the way people name their own (renamed in production 2026-10-27; "Lower A" read like a
  // template, and the marketing hero shows the routine strip).
  const names = person.name === 'Alex' ? ['Squat Day', 'Bench Day', 'Deadlift Day', 'Press & Pull']
    : person.name === 'Sam' ? ['Squat + Bench', 'Deadlift + Press'] : ['After-School Lift', 'Weekend Lift'];
  for (let i = 0; i < person.rotation.length; i++) {
    await call('POST', `/api/people/${pid}/routines`, { name: names[i], exercises: person.rotation[i].map((x) => ({ exerciseId: exId(x) })) });
  }
  // Read it back: every planned workout is either in History or counted as hidden behind the Free
  // window, and nothing else is.
  const shown = (await call('GET', `/api/people/${pid}/history`)).length;
  const hidden = (await call('GET', `/api/people/${pid}/history-window`)).hiddenSessions ?? 0;
  if (shown + hidden !== sessions.length) throw new Error(`${person.name}: wrote ${sessions.length} workouts but the account shows ${shown} + ${hidden} hidden`);
  console.log(`wrote ${person.name}: ${sessions.length} workouts (${shown} in History, ${hidden} older), ${n} sets, ${notes.length} notes, ${person.rotation.length} routines`);
}
console.log('done');
