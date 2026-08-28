import { isTempExerciseId } from '../../lib/exerciseIdMap';

// Case-insensitive by NAME, never by id -- ids are per-environment (the seeded catalog differs
// between local/lower/production), so an id literal here would silently match nothing on two of
// the three. Ordered by how likely each is to already exist in a household's catalog.
export const PREFERRED_TOUR_EXERCISES = ['Barbell Back Squat', 'Barbell Bench Press', 'Deadlift', 'Push-Up'];

// Two filters that matter, applied everywhere in the fallback chain below, not just at the end:
//   - trackingType === 'duration' is excluded because the second stepper on that screen reads
//     "Time" and a "Start timer" button appears there instead -- step 5's "weight and reps" copy
//     is simply wrong for one of these.
//   - a temp id (isTempExerciseId) is excluded because Customize is `disabled` for one -- step 7
//     must never spotlight a dead control.
function isEligible(exercise) {
  return exercise.trackingType !== 'duration' && !isTempExerciseId(exercise.id);
}

// Which exercise ProductTour opens for steps 5-7. Pure -- no hooks, no dispatch -- so it can be
// unit tested with plain objects, and mounted straight inside ProductTour rather than AppShell (see
// that component's own header comment on why History/PRs/Trends must not gain a permanent catalog
// observer just for this). The tour writes nothing: whatever this returns is handed straight to
// AppStateContext's selectExercise, a pure dispatch.
//
// Fallback order: the person's first favorite -> the person's first listed exercise -> a named
// catalog preference, matched case-insensitively -> the first eligible catalog row sorted by name
// -> null (an empty catalog on a brand-new device, before anything has ever synced).
export function pickTourExercise({ personExercises = [], catalog = [] } = {}) {
  const eligiblePersonExercises = personExercises.filter(isEligible);

  const favorite = eligiblePersonExercises.find((e) => e.isFavorite);
  if (favorite) return favorite;

  if (eligiblePersonExercises.length > 0) return eligiblePersonExercises[0];

  const eligibleCatalog = catalog.filter(isEligible);

  for (const preferredName of PREFERRED_TOUR_EXERCISES) {
    const match = eligibleCatalog.find((e) => e.name.toLowerCase() === preferredName.toLowerCase());
    if (match) return match;
  }

  const sortedByName = [...eligibleCatalog].sort((a, b) => a.name.localeCompare(b.name));
  return sortedByName[0] ?? null;
}
