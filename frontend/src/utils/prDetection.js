import { comparableValue, weightLb } from './formulas';
import { formatSetSpaced } from './formatSet';
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
//   bodyweight lift  weight 0, so toLb(weight) is 0                          -> heaviest never fires
//   failed set       0 reps at weight 0 -> comparable 0                      -> nothing fires
//
// Session volume is deliberately NOT one of these set measures and is not decided in this file: it
// is measured in each exercise's own unit (pounds, reps or seconds) and has its own first-workout
// rule, and both live in sessionVolume.js -- the one definition the server's SessionVolume.java is
// pinned to.
//
// It also gets the transition right in the one direction that matters: the first time someone puts
// 10 lb on a previously-bodyweight pull-up, 10 > 0 and a top-weight PR fires, which is correct and
// is exactly the moment worth marking.

// The single number each SET-level celebrated measure ranks on, in a unit-normalized form.
// comparableValue already carries the weight-0 -> reps and hold -> seconds substitutions.
//
// EXPORTED because historyPrFlags.js ranks on exactly the same numbers. It used to hold a
// byte-identical copy with a comment on each saying it mirrored the other, which is a rule two
// files have to keep by hand. The two functions stay separate -- they differ in what "prior best"
// means -- but the MATHS is one table. See .claude/rules/log-screen.md.
export const SET_MEASURE_VALUE = {
  est1rm: (set) => comparableValue(set),
  heaviest: (set) => weightLb(set),
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

// ## The quiet "First <exercise>" card needs CERTAINTY, not an absence
//
// isFirstEver() answers "has THIS DEVICE seen a best", and that is not the same question as "has
// this person ever logged it". A Free household's device holds 90 days of History, and offline the
// server summary is unavailable or a cached answer from an earlier day -- so "nothing found" can be
// a deadlift from five months ago. Showing the quiet card then would swallow a real PR, which is
// the one thing a celebration change may never do. So the quiet card needs the SERVER to have said
// "never logged" on this visit: the summary is computed over full history even on Free
// (billing.md, "PR detection uses full history even on Free"). Anything short of that -- offline,
// lie-fi, cold start, a revalidation still in flight -- falls back to the full "New PR!", which is
// exactly what every first set showed before this card existed. That fallback is on the register
// in .claude/rules/resilience.md; it is keyed on the READ's state, never on connectivity.
//
// Only the first set ever is quiet (option (c), agreed 2026-11-24). From set 2 on -- including set
// 2 of that same first workout -- set 1 is folded into the prior bests (mergeBestWithLocalSets), so
// anything that beats it is a full "New PR!" by the ordinary rule. There is no "first workout"
// state to keep.

// `query` is the TanStack summary query's { status, fetchStatus, data }.
export function summaryConfirmsNeverLogged(query) {
  if (!query || query.status !== 'success' || query.fetchStatus !== 'idle') return false;
  const data = query.data;
  return data != null && data.best == null && data.heaviestWeightLb == null;
}

export function isCertainFirstEver(priorBests, serverConfirmsNeverLogged) {
  return isFirstEver(priorBests) && priorBests?.heaviestLb == null && serverConfirmsNeverLogged === true;
}

// The one row on the quiet card: the set itself, as a person would say it. Bodyweight reads
// "10 reps" rather than formatSetSpaced's compact "BW × 10" -- this is a sentence on a card, not a
// pill in a list.
export function startingMarkText(set) {
  if (set?.durationSeconds == null && !(Number(set?.weight) > 0)) {
    return `${set.reps} ${set.reps === 1 ? 'rep' : 'reps'}`;
  }
  return formatSetSpaced(set);
}

export { CELEBRATED_PR_TYPES };
