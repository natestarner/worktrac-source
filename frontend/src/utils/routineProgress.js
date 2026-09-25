// Which steps of a running routine are done, which were skipped, and where "Next exercise" goes.
// One derivation, so the pill strip, the Next/Finish button and the finish toast cannot disagree.
//
// A step is DONE only when a set was actually logged for it -- not because it is behind the
// current position:
//
//   - `loggedSteps`: the step indexes a set was logged AT (AppStateContext's routineLoggedSteps),
//     recorded synchronously at the tap. A recorded step is done, full stop. By position, because
//     that is what tells the two bench positions of "bench, row, bench" apart -- sets are stored per
//     exercise per session, so the session alone cannot say which position a set belongs to.
//   - `loggedExerciseIds`: the exercises with at least one set in this session (useSessionEntries).
//     Used ONLY to credit a set logged outside the routine (from the picker, or before it was
//     started): it has no step, so it credits the exercise's FIRST position -- unless some position
//     of that exercise already has a logged step, in which case the routine knows where that
//     exercise's work went.
//
// ⚠️ Don't make a recorded step ALSO require its exercise to be in `loggedExerciseIds`. It reads
// like the way to un-do a step whose sets were deleted, but useSessionEntries briefly LOSES a set
// the moment it syncs: its LOG_SET leaves the pending list on success, and `history` only has it
// once its refetch lands (the same window SessionSummary's mayHaveServerRows describes). Online,
// finishing a routine in that window counted the step just logged as skipped. Removing an
// exercise from "Session exercises" un-records its steps explicitly instead (LogTab); deleting its
// sets one by one on the exercise screen leaves the step done.
export function routineProgress(routineExercises, currentIndex, loggedSteps, loggedExerciseIds) {
  const recorded = new Set(loggedSteps);
  const done = routineExercises.map((step, idx) => {
    if (recorded.has(idx)) return true;
    if (!loggedExerciseIds.has(step.exerciseId)) return false;
    const positions = [];
    routineExercises.forEach((other, i) => {
      if (other.exerciseId === step.exerciseId) positions.push(i);
    });
    return positions[0] === idx && !positions.some((i) => recorded.has(i));
  });

  // "Skipped" means passed over: not done, and before the furthest point reached -- the later of
  // the current step and the last done one. Going back to fill in an earlier step therefore leaves
  // the steps between it and that furthest point reading as skipped, not as upcoming.
  const furthest = Math.max(currentIndex, done.lastIndexOf(true));
  const skipped = done.map((isDone, idx) => !isDone && idx !== currentIndex && idx < furthest);

  // Forward only. Wrapping back to earlier skipped steps would mean a routine with a deliberately
  // skipped step could never reach "Finish routine" -- the pills are how you go back.
  let nextIndex = null;
  for (let i = currentIndex + 1; i < done.length; i++) {
    if (!done[i]) {
      nextIndex = i;
      break;
    }
  }

  return { done, skipped, nextIndex };
}
