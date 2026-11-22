import { exerciseTrend, trendsOverview, workoutExercises } from './statsFromHistory';
import { formatDateLabel } from './datetime';

// The one line of encouragement at the top of the workout-done sheet: the single best thing that is
// TRUE about the workout just ended, or null.
//
// ## Nothing here measures anything
//
// Every number is read from the fold the PRs board and Trends already use (statsFromHistory.js --
// exerciseTrend's `isPr` and its comparable best, trendsOverview's weeks and streak), so the sheet
// can never disagree with those screens, and there is no second implementation of a record or a
// week to drift. This file only CHOOSES among their answers and words the choice.
//
// ## In order, the first that is true wins
//
//   1. A new best today on an exercise done before (a first-ever set is a baseline, not a record --
//      the PR celebration's rule).
//   2. An exercise done today is up on its earliest workout in History: "up 7% since Oct 3". A
//      percentage of the exercise's own comparable best (est. 1RM loaded, reps bodyweight, seconds
//      held), so it needs no unit and reads the same for a squat, a pull-up and a plank. Dated
//      rather than "since your first workout", because on Free History stops at the window and the
//      earliest workout ON THE DEVICE may not be the first.
//   3. The most workouts in a week yet (needing an earlier trained week to beat), then a streak of
//      two or more weeks.
//   4. A neutral count: "2nd workout this week." Never a drop, never invented praise.
//
// The first workout ever gets its own line instead: there is nothing to compare against, so it
// names the starting point. Claimed only when History is on the device AND nothing is hidden
// behind the Free window -- otherwise "first" might be false.
//
// ## Computed at the End tap, never after
//
// EndWorkoutConfirmModal calls this when End is tapped, while the workout is still live and its
// unsynced sets are still folded in (useStatsFromHistory's `live`). After the End they are not:
// a finished workout's queued sets leave the live fold, and History has not got them yet, so
// computing it in the sheet would miss the very workout it describes -- in every degraded mode.
// The same reason the recap's numbers are counted in the modal and handed over.
//
// `ready` is useStatsFromHistory's status === 'ready'. Anything else means History is not on this
// device, and every comparison above would be against nothing: return null and the sheet shows the
// numbers alone.

const ALL_WEEKS = 260;
const MIN_GAIN = 0.01;

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

export function workoutHeadline(digests, { workoutId, ready, zone, now, windowStart = null, hiddenSessions = 0 }) {
  if (!ready) return null;
  const exercises = workoutExercises(digests, workoutId);
  // The workout is not in what the device holds (a sync landed between the fold and the tap). Saying
  // nothing is honest; anything else would be measured without it.
  if (exercises.length === 0) return null;

  const workoutCount = digests.reduce((n, digest) => n + digest.workouts.length, 0);
  if (workoutCount === 1 && hiddenSessions === 0) {
    return 'Your first workout is in. Everything from here is measured against today.';
  }

  const trendOpts = { weeks: ALL_WEEKS, zone, now, windowStart };
  const perExercise = exercises.map(({ exerciseId, name }) => {
    const points = exerciseTrend(digests, exerciseId, trendOpts);
    const index = points.findIndex((p) => p.sessionId === workoutId);
    return { name, points, index, today: points[index] };
  });

  // 1. A new best on something done before.
  const records = perExercise.filter((e) => e.index > 0 && e.today.isPr);
  if (records.length === 1) return `A new best on ${records[0].name} today.`;
  if (records.length > 1) return `New bests on ${records.length} exercises today.`;

  // 2. The biggest rise on an earlier workout of the same exercise. est1rmLb is the trend point's
  //    comparable best whatever the exercise's kind (exerciseTrend), so a ratio of two is unitless.
  let best = null;
  for (const e of perExercise) {
    if (e.index <= 0) continue;
    const first = e.points[0];
    if (!(first.est1rmLb > 0) || first.date === e.today.date) continue;
    const gain = (e.today.est1rmLb - first.est1rmLb) / first.est1rmLb;
    if (gain >= MIN_GAIN && (!best || gain > best.gain)) best = { gain, name: e.name, since: first.date };
  }
  if (best) {
    // formatDateLabel says "Yesterday" for yesterday, which is a heading's capital, not a sentence's.
    const since = formatDateLabel(best.since);
    const sinceInSentence = since === 'Yesterday' ? 'yesterday' : since;
    return `${best.name} is up ${Math.round(best.gain * 100)}% since ${sinceInSentence}.`;
  }

  // 3. The week.
  const overview = trendsOverview(digests, { weeks: ALL_WEEKS, zone, now, hiddenSessions });
  const thisWeek = overview.workoutsThisWeek;
  const earlier = overview.weeks.slice(0, -1).map((w) => w.workoutCount);
  if (thisWeek >= 2 && earlier.some((n) => n > 0) && earlier.every((n) => n < thisWeek)) {
    return `${thisWeek} workouts this week, your most yet.`;
  }
  if (overview.currentStreakWeeks >= 2) {
    return `${overview.currentStreakWeeks} weeks in a row with a workout.`;
  }

  // 4. Plainly, where this one falls. A workout begun before midnight on Sunday is last week's, so
  //    this week may hold none -- and "your 0th workout" is not a sentence.
  if (thisWeek === 0) return null;
  return thisWeek === 1 ? 'Your first workout this week.' : `Your ${ordinal(thisWeek)} workout this week.`;
}
