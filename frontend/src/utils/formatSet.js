// Single place producing a "{weight}{unit}x{reps}" string -- the one function to touch
// when cardio sets (duration/distance/pace instead of weight/reps) are added later.
export function formatSet(set) {
  return `${set.weight}${set.unit || 'lb'}×${set.reps}`;
}

export function formatSetSpaced(set) {
  return `${set.weight} ${set.unit || 'lb'} × ${set.reps}`;
}
