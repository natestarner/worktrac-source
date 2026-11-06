// The muscle vocabulary "muscles worked" is described with -- the client's copy of the `muscles`
// table (backend V90/V91). The server sends only codes (`exercise.primaryMuscles`,
// `exercise.secondaryMuscles`); everything a person reads comes from here.
//
// Both this list and the server's table must equal shared/muscles/muscles.json (muscles.test.js and
// LibraryExerciseMusclesTest), so a muscle added on one side only cannot ship. Not imported from there:
// nothing in the production bundle reaches outside frontend/.
//
//   drawn   -- has a shape on the body diagram
//   counted -- counts toward muscle-volume statistics. 'full_body' and 'cardio' are labels for
//              conditioning work, not muscles, so they count toward nothing.
export const MUSCLES = [
  { code: 'neck', name: 'Neck', drawn: false, counted: true },
  { code: 'traps', name: 'Traps', drawn: true, counted: true },
  { code: 'shoulders', name: 'Shoulders', drawn: true, counted: true },
  { code: 'rear_delts', name: 'Rear delts', drawn: true, counted: true },
  { code: 'chest', name: 'Chest', drawn: true, counted: true },
  { code: 'biceps', name: 'Biceps', drawn: true, counted: true },
  { code: 'triceps', name: 'Triceps', drawn: true, counted: true },
  { code: 'forearms', name: 'Forearms', drawn: true, counted: true },
  { code: 'upper_back', name: 'Upper back', drawn: true, counted: true },
  { code: 'lats', name: 'Lats', drawn: true, counted: true },
  { code: 'lower_back', name: 'Lower back', drawn: true, counted: true },
  { code: 'abs', name: 'Abs', drawn: true, counted: true },
  { code: 'obliques', name: 'Obliques', drawn: true, counted: true },
  { code: 'hip_flexors', name: 'Hip flexors', drawn: false, counted: true },
  { code: 'glutes', name: 'Glutes', drawn: true, counted: true },
  { code: 'abductors', name: 'Abductors', drawn: false, counted: true },
  { code: 'adductors', name: 'Adductors', drawn: false, counted: true },
  { code: 'quads', name: 'Quads', drawn: true, counted: true },
  { code: 'hamstrings', name: 'Hamstrings', drawn: true, counted: true },
  { code: 'calves', name: 'Calves', drawn: true, counted: true },
  { code: 'full_body', name: 'Full body', drawn: false, counted: false },
  { code: 'cardio', name: 'Cardio', drawn: false, counted: false },
];

const BY_CODE = new Map(MUSCLES.map((m) => [m.code, m]));

export function muscleByCode(code) {
  return BY_CODE.get(code);
}

// Display name for a code. A code this build does not know (a muscle added to the server after
// this App Store build shipped) is shown as nothing rather than as its raw code.
export function muscleName(code) {
  return BY_CODE.get(code)?.name;
}

// An exercise's muscles, tolerant of every shape a client can hold: a catalog row cached before the
// fields existed (absent), a temp row created offline (absent), and codes this build does not know
// (dropped). Always returns arrays, so callers never branch on "has muscles data".
export function exerciseMuscles(exercise) {
  const known = (codes) => (Array.isArray(codes) ? codes.filter((c) => BY_CODE.has(c)) : []);
  return {
    primary: known(exercise?.primaryMuscles),
    secondary: known(exercise?.secondaryMuscles),
  };
}
