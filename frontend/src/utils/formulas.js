// Client-side preview only (under the weight/rep steppers) -- the server is
// authoritative for PR determination, PRs tab, and CSV export. Mirrors
// backend/.../stats/EpleyCalculator.java and UnitConverter.java.

const LB_PER_KG = 2.20462;

export function epley(weight, reps) {
  if (reps <= 1) return Math.round(weight * 10) / 10;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

export function toLb(weight, unit) {
  return unit === 'kg' ? weight * LB_PER_KG : weight;
}

export function convertWeight(weight, fromUnit, toUnit) {
  if (fromUnit === toUnit) return weight;
  if (fromUnit === 'kg' && toUnit === 'lb') return Math.round(weight * LB_PER_KG * 2) / 2;
  if (fromUnit === 'lb' && toUnit === 'kg') return Math.round((weight / LB_PER_KG) * 2) / 2;
  return weight;
}

// Prefill weight/reps, in this order of preference:
//
// 1. The same set-index in the most recent prior session -- e.g. if you're about to log your
//    2nd set today, this picks the 2nd set from last session (not just the last set overall),
//    clamping to the last available set if today's session has already gone further than last
//    time did. Converted to today's default unit if the prior set was recorded in another.
// 2. The last set already logged TODAY for this exercise. Only reachable on an exercise with
//    no prior session at all, and it is what stops a brand-new exercise re-seeding to the
//    empty default before every single set of its first-ever workout.
// 3. Nothing to go on: `weight: null`, meaning "no history yet".
//
// `null` is a display state, not a validation gate -- ExerciseDetail renders it as an em dash
// and logs it as 0. That deliberately makes a first-ever bodyweight exercise (pull-up, plank)
// correct with no interaction: 0 already means "bodyweight" everywhere downstream
// (comparableLb, prSort.isBodyweight, the backend's bodyweightOnly). The previous 45 lb default
// was wrong for those, wrong for dumbbells and machines, and only right for a barbell.
//
// `todaysSets` must be the MERGED set list (ExerciseDetail's displaySets), never the raw
// sessionSets query -- see the call site.
// The same walk resolves the second measure too: `reps` for a lift, `durationSeconds` for a hold.
// Both are always returned so ExerciseDetail can read whichever its exercise uses without the
// prefill needing to know the exercise's type.
export function computePrefillDraft(lastSession, todaysSets, defaultUnit) {
  const todays = todaysSets || [];
  if (!lastSession || lastSession.sets.length === 0) {
    const carry = todays[todays.length - 1];
    if (!carry) return { weight: null, reps: 8, durationSeconds: 30 };
    return {
      weight: convertWeight(carry.weight, carry.unit || 'lb', defaultUnit),
      reps: carry.reps,
      durationSeconds: carry.durationSeconds ?? 30,
    };
  }
  const idx = Math.min(todays.length, lastSession.sets.length - 1);
  const refSet = lastSession.sets[idx];
  return {
    weight: convertWeight(refSet.weight, refSet.unit || 'lb', defaultUnit),
    reps: refSet.reps,
    durationSeconds: refSet.durationSeconds ?? 30,
  };
}

// Epley collapses to 0 at weight 0 regardless of reps, so a bodyweight set (no added
// load) would always tie every other bodyweight set instead of reps actually mattering.
// Reps are the only real signal of performance with zero added weight, so compare on
// reps directly in that case. Mirrors backend/.../stats/StatsService.java#comparableLb.
export function comparableLb(weight, reps, unit) {
  if (weight === 0) return reps;
  return toLb(epley(weight, reps), unit || 'lb');
}

// The single number a set is ranked by, whichever measure it uses. Mirrors
// backend/.../stats/StatsService.java#comparableValue -- keep the two in step.
//
// Every comparison this feeds is within ONE exercise, and an exercise has exactly one measure, so
// seconds are never weighed against pounds. For a hold the value is the duration and added load
// deliberately does not enter it: a load-adjusted hold would need the person's bodyweight, which
// the app doesn't store. Load is surfaced as its own "Heaviest load held" record instead.
export function comparableValue(set) {
  if (set == null) return null;
  if (set.durationSeconds != null) return set.durationSeconds;
  return comparableLb(set.weight, set.reps, set.unit);
}

// Whether a logged set matches the person's current best comparable value for that
// exercise (within a small tolerance for rounding), used to show the inline "PR" badge
// on session-set rows. bestComparable must come from comparableValue() above, not the
// raw displayed est1rm, or it inherits the same weight-0 collapse this is guarding against.
export function isPrSet(set, bestComparable) {
  if (bestComparable === null || bestComparable === undefined) return false;
  return Math.abs(comparableValue(set) - bestComparable) < 0.5;
}
