// THE set-level record measures on the client: epley (est. 1RM), comparableValue (the number a set
// is ranked by) and weightLb (top weight), plus the pound conversion under them. The celebration,
// History's and the Log screen's badges, the offline summary and the PRs board all read these.
// Their server twins are EpleyCalculator.java, SetMeasures.java and UnitConverter.java, and the two
// sides are pinned by shared/record-rules/set-measures-cases.json, which BOTH test suites run
// (formulas.test.js, SetMeasuresTest.java). Change a rule on one side only and a build fails.

const LB_PER_KG = 2.20462;
// The same factor as an integer (x 1e5), so toLb can convert without floating-point error. Must
// equal LB_PER_KG -- and UnitConverter.java's -- which the shared set-measure cases check.
const LB_PER_KG_E5 = 220462;

// The highest rep count that still contributes to an estimated 1RM. Mirrors
// backend/.../stats/EpleyCalculator.java#EST_1RM_REP_CAP -- keep the two in step.
export const EST_1RM_REP_CAP = 12;

// Epley, with reps clamped at EST_1RM_REP_CAP. The clamp is what stops the measure being gamed:
// Epley is only validated to roughly 10-12 reps and climbs without bound past that, so an uncapped
// 135x30 estimates to 270 lb and takes the record off a genuine 225x3.
//
// Clamping rather than excluding a high-rep set keeps the measure MONOTONIC -- more reps never
// lowers your score, it only stops raising it. Excluding them would create a cliff where 12 reps
// counts and 13 vanishes, leaving someone's hardest set off the board entirely.
//
// This is deliberately NOT applied to comparableLb's weight-0 branch below, where a bodyweight set
// ranks on its raw rep count -- a cap there would tie every pull-up set above 12 forever.
//
// ⚠️ EXACT, IN INTEGERS, and it has to be. weight x (30 + reps) / 30, rounded half-up to 0.1, with
// the weight taken in hundredths -- the database's own precision (DECIMAL(6,2)). This used to be
// floating point, and the server's version rounded reps/30 to ten decimals first; at every
// estimate ending exactly in x.x5 the two rounded opposite ways (187.5 x 7 = 231.25 was 231.3 here
// and 231.2 on the PRs board). shared/record-rules/set-measures-cases.json pins this to
// EpleyCalculator.java, ties included.
export function epley(weight, reps) {
  const hundredths = Math.round(Number(weight) * 100);
  const effectiveReps = reps <= 1 ? 0 : Math.min(reps, EST_1RM_REP_CAP);
  // tenths = hundredths * (30 + r) / 300, rounded half up -- floor((2n + d) / 2d) on integers.
  const numerator = hundredths * (30 + effectiveReps);
  return Math.floor((2 * numerator + 300) / 600) / 10;
}

// Pounds, as the nearest double to the EXACT decimal the server computes with BigDecimal. The
// conversion is done on integers (hundredths of the entered weight x 2.20462 x 1e5), divided once:
// plain `weight * 2.20462` lands a hair above the exact value for some weights (32.52 kg), and
// since the server sends its thresholds exact, re-logging your own best would then "beat" it.
// Inputs are weights or est.-1RM values, both of which have at most two decimals.
export function toLb(weight, unit) {
  return lbE7(weight, unit) / 1e7;
}

// Pounds x 1e7 as an EXACT integer. Anything that sums pounds (sessionVolume.js) adds these and
// divides once, so a total is the same exact decimal the server's BigDecimal sum is -- adding
// already-rounded doubles would drift from it by an ulp and let a repeat of a record "beat" it.
export function lbE7(weight, unit) {
  const hundredths = Math.round(Number(weight) * 100);
  return unit === 'kg' ? hundredths * LB_PER_KG_E5 : hundredths * 100000;
}

// THE top-weight measure: the load on the bar in pounds, so kg and lb sets rank together. Weight 0
// (bodyweight) is 0, which is why top weight never fires for one. Also the load half of every
// weight x reps figure (sessionVolume.js). Mirrors SetMeasures.java#weightLb, pinned by the shared
// cases -- read it through here, never as an inline toLb(set.weight).
export function weightLb(set) {
  return toLb(Number(set?.weight) || 0, set?.unit || 'lb');
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
// reps directly in that case. Mirrors SetMeasures.java#comparableLb (shared cases).
//
// Numeric, not `=== 0`: the server compares a DECIMAL, and a weight that reached here as the string
// "0" (a form field, a CSV-shaped value) is still a bodyweight set.
export function comparableLb(weight, reps, unit) {
  if (Number(weight) === 0) return reps;
  return toLb(epley(weight, reps), unit || 'lb');
}

// THE number a set is ranked by for the est.-1RM record, whichever measure it uses. Mirrors
// SetMeasures.java#comparableValue, pinned by the shared set-measure cases.
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

// ⚠️ `isPrSet` used to live here: a +-0.5 TIE against the all-time best, answering "is this my
// best" for the Log screen's PR pill. It is gone, deliberately, and should not come back.
//
// It was the third of three "is this a PR" predicates, and the only one asking a different
// question -- so hitting your best three times pilled three rows on the Log screen and badged one
// on History. It also only ever knew about est. 1RM, so a top-weight record went unmarked there.
// Every record mark in the app now comes from historyPrFlags.js#buildHistoryPrFlags (strict `>`
// against the running best), which the celebration's prDetection.js#setPrTypes shares its maths
// with. See .claude/rules/log-screen.md.
