// How weight applies to a set of an exercise: the one place the app reads `loadType` (V107).
//
// Two independent questions describe an exercise, and they are kept apart on purpose:
//   - trackingType: what do you COUNT -- 'strength' (reps) or 'duration' (seconds), one day distance
//   - loadType:     is a WEIGHT expected -- 'external' (barbell, machine, weighted dips) or
//                   'bodyweight' (usually just you; the number is weight ADDED on top)
// A future value on either axis ('none' for a run, 'assisted' for a counterweight machine) is a
// change here and in Exercise.java, not a rework of the other axis.
//
// The load type decides only two things, both on the Log screen: what the weight box is called,
// and how a person's FIRST set of an exercise asks for its weight. Records, volume and every stat
// read each set's own weight, never this.

export const LOAD_EXTERNAL = 'external';
export const LOAD_BODYWEIGHT = 'bodyweight';

// ⚠️ Anything else -- a catalog cached before the field existed (axis D), an optimistic row built by
// an older bundle, or a value a newer server added -- reads as 'external': an empty weight box with
// "No weight, just bodyweight" under it. That can cost one tap; it can never strand anyone.
export function loadTypeOf(exercise) {
  return exercise?.loadType === LOAD_BODYWEIGHT ? LOAD_BODYWEIGHT : LOAD_EXTERNAL;
}

export function isBodyweightLoad(loadType) {
  return loadType === LOAD_BODYWEIGHT;
}

// "Added" on a bodyweight exercise: 0 there honestly means "just me", and a vest is the number on
// top. Never the jargon "BW" in the box. Not "Added weight (lb)": that wrapped to two lines beside
// the stepper on an iPhone, while "Added (lb)" is as wide as "Weight (lb)".
//
// ⚠️ Both labels contain "weight" on purpose: the stepper's aria-label is this text, and every e2e
// helper finds the box with a case-insensitive substring ("Weight", "Weight (lb)").
export function weightLabel(loadType, unit) {
  return isBodyweightLoad(loadType) ? `Added (${unit})` : `Weight (${unit})`;
}

// "Measured in" on Add exercise and in Customize: ONE row of three choices standing for the two
// axes together, so the form gains no second question. Defaults to Weight & reps, with no guessing
// from the name (decided 2026-11-24: a wrong guess is worse than a predictable default, and most
// custom exercises are the gym's odd machine).
//
// Kept apart from exerciseDuplicates.js's MEASURE_OPTIONS on purpose: that list also writes the
// "(Reps)" / "(Time)" suffix that tells two same-named exercises apart, and Weight & reps vs
// Bodyweight are the SAME movement family, never a reason for a second exercise.
export const EXERCISE_KIND_OPTIONS = [
  { label: 'Weight & reps', value: 'weight' },
  { label: 'Bodyweight', value: 'bodyweight' },
  { label: 'Time', value: 'time' },
];

export const DEFAULT_EXERCISE_KIND = 'weight';

// A Time exercise is "added weight" by nature (a vest on a plank), as it always was.
export function fieldsForKind(kind) {
  if (kind === 'time') return { trackingType: 'duration', loadType: LOAD_BODYWEIGHT };
  if (kind === 'bodyweight') return { trackingType: 'strength', loadType: LOAD_BODYWEIGHT };
  return { trackingType: 'strength', loadType: LOAD_EXTERNAL };
}

export function kindOf(exercise) {
  if (exercise?.trackingType === 'duration') return 'time';
  return isBodyweightLoad(loadTypeOf(exercise)) ? 'bodyweight' : 'weight';
}
