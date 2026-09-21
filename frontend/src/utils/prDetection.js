import { comparableValue, toLb } from './formulas';
import { CELEBRATED_PR_TYPES, SET_PR_TYPES } from '../components/trends/exerciseMetrics';

// Which records a set just set. ONE derivation, three consumers: the celebration overlay
// (ExerciseDetail#handleLogSet), History's per-set badges (historyPrFlags.js) and the Log screen's
// "close to a PR" hint. They ask the same question against different prior bests -- "everything
// before this set", for a value of "before" that each consumer supplies.
//
// ## Why this runs on the client
//
// The celebration used to read the server's `isPR` off the log-set response. That response never
// arrives while hard-offline (the mutation never settles), arrives with `data === undefined` under
// lie-fi, and after a reload the outbox replay has no component observer at all -- so a PR set in a
// gym basement was never celebrated, and after a reload was never celebrated even once the write
// landed. Detection here runs at DISPATCH, off values the client already holds, so it fires
// identically in every connectivity mode. That is one code path, not a connectivity branch.
//
// ## The predicates this does and does not replace
//
// Still strict `>` against the prior best, matching WorkoutSetService#insertSetAndDetectPr, which
// remains the backend's own answer for its own purposes. formulas.js#isPrSet -- a +-0.5 TIE that
// answered "is this my best" for the Log screen's pill -- has been removed; every record mark in
// the app is now strict `>`, and this file and historyPrFlags.js share their maths through
// SET_MEASURE_VALUE below. See .claude/rules/log-screen.md.
//
// ## Applicability is self-guarding -- do not add a bodyweightOnly flag here
//
// Every measure requires `value > 0`, and that single rule makes the meaningless cases impossible
// without the caller having to classify the exercise:
//
//   bodyweight lift  weight 0, so toLb(weight) and weight x reps are both 0  -> heaviest/volume never fire
//   timed hold       reps 0, so weight x reps is 0                           -> volume never fires
//   failed set       0 reps at weight 0 -> comparable 0                      -> nothing fires
//
// It also gets the transition right in the one direction that matters: the first time someone puts
// 10 lb on a previously-bodyweight pull-up, 10 > 0 and a top-weight PR fires, which is correct and
// is exactly the moment worth marking.

// Weight x reps in pounds -- the volume contribution of one set. A hold carries reps 0, so it
// contributes nothing, which is why volume never fires for a duration-tracked exercise. Mirrors
// StatsService#setVolumeLb.
export function setVolumeLb(set) {
  if (!set) return 0;
  const weight = Number(set.weight);
  const reps = Number(set.reps);
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return 0;
  return toLb(weight, set.unit || 'lb') * reps;
}

// Total volume across a list of sets, in pounds.
export function sessionVolumeLb(sets) {
  let total = 0;
  for (const set of sets || []) total += setVolumeLb(set);
  return total;
}

// The single number each SET-level celebrated measure ranks on, in a unit-normalized form.
// comparableValue already carries the weight-0 -> reps and hold -> seconds substitutions.
//
// EXPORTED because historyPrFlags.js ranks on exactly the same numbers. It used to hold a
// byte-identical copy with a comment on each saying it mirrored the other, which is a rule two
// files have to keep by hand. The two functions stay separate -- they differ in what "prior best"
// means -- but the MATHS is one table. See .claude/rules/log-screen.md.
export const SET_MEASURE_VALUE = {
  est1rm: (set) => comparableValue(set),
  heaviest: (set) => toLb(Number(set?.weight) || 0, set?.unit || 'lb'),
};

// Which set-level records this set takes, given the bests BEFORE it.
//
// `priorBests` is `{ comparable, heaviestLb }` -- null/undefined on a measure means "nothing
// logged on it yet". A missing prior is treated as beatable, so a genuine first set is reported;
// callers that want to present that differently ask isFirstEver() rather than getting a quieter
// answer from here. Returned in CELEBRATED_PR_TYPES precedence order so every consumer renders a
// given combination the same way round.
export function setPrTypes(set, priorBests) {
  if (!set) return [];
  const priors = { est1rm: priorBests?.comparable, heaviest: priorBests?.heaviestLb };
  return SET_PR_TYPES.filter((type) => {
    const value = SET_MEASURE_VALUE[type](set);
    if (!Number.isFinite(value) || value <= 0) return false;
    const prior = priors[type];
    return prior == null || value > prior;
  });
}

// True when nothing has ever been logged for this exercise. The first set of anything is
// technically a record on every measure at once, which is a baseline rather than an achievement --
// the overlay says "first time" and skips the confetti instead of claiming three PRs.
export function isFirstEver(priorBests) {
  return priorBests?.comparable == null;
}

// Whether this set is the one that takes the session-volume record.
//
// ⚠️ Deliberately stateless, and that is what makes it work offline. A "have I already celebrated
// this session?" flag has to be keyed on something, and the only natural key -- the session id --
// is `null` for a person's ENTIRE offline/lie-fi stretch (contextSessionId, see log-screen.md), so
// it would disable the guard in precisely the modes this feature exists for.
//
// Asking whether the running total CROSSES the record is inherently once-per-session instead: once
// you are past it, `before` stays above the record for the rest of the workout and this cannot
// return true again. No flag, no session identity, no lifecycle events to keep in step.
//
// `priorBestSessionVolumeLb` must EXCLUDE the current session, or the record chases itself: after
// the crossing the current session becomes the best, `before <= prior` goes true again, and the
// next set re-fires. Both callers exclude it -- online via getSummary's excludeSessionId, offline
// by dropping sessions at or after the live session's startedAt.
export function crossesSessionVolume(volumeBefore, volumeAfter, priorBestSessionVolumeLb) {
  if (!Number.isFinite(volumeAfter) || volumeAfter <= 0) return false;
  if (!Number.isFinite(volumeBefore)) return false;
  const prior = Number.isFinite(priorBestSessionVolumeLb) ? priorBestSessionVolumeLb : 0;
  return volumeBefore <= prior && volumeAfter > prior;
}

export { CELEBRATED_PR_TYPES };
