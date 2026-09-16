import { formatRestTime } from './datetime';

// The single place a logged set becomes text. Every screen that renders a set goes through here --
// the Log tab's rows, History, PRs, the records table, the outbox detail list -- so a new measure
// is added once rather than in each of them.
//
// A set is either weight x reps or added-load x seconds held, decided by its exercise's
// trackingType. The marker is `durationSeconds != null`, NEVER `reps === 0`: 0 reps is also a
// legal strength value (a failed set), and reading it as "this is a hold" would mislabel one.
//
// Times are m:ss via formatRestTime -- the app's one seconds-to-clock formatter, shared with the
// rest timer and the hold timer so a duration never changes shape between where you enter it and
// where you read it back.
//
//   135lb×8      a lift
//   0:45         a bodyweight hold
//   25lb×0:45    a loaded hold

function isHold(set) {
  return set != null && set.durationSeconds != null;
}

export function formatSet(set) {
  if (isHold(set)) {
    const time = formatRestTime(set.durationSeconds);
    return Number(set.weight) > 0 ? `${set.weight}${set.unit || 'lb'}×${time}` : time;
  }
  return `${set.weight}${set.unit || 'lb'}×${set.reps}`;
}

export function formatSetSpaced(set) {
  if (isHold(set)) {
    const time = formatRestTime(set.durationSeconds);
    return Number(set.weight) > 0 ? `${set.weight} ${set.unit || 'lb'} × ${time}` : time;
  }
  return `${set.weight} ${set.unit || 'lb'} × ${set.reps}`;
}

// A trainer's PRESCRIBED target, as text. Lives here rather than beside the Log screen for the
// same reason formatSet does: this is the one place a set becomes words, and a target is a set
// somebody has not done yet.
//
// ⚠️ Unlike a logged set, a target can be PARTIAL. "5 reps at whatever weight you can manage" and
// "135 lb, as many as you get" are both real prescriptions, so each half renders on its own and the
// caller gets null when there is nothing to say. formatSetSpaced cannot be reused directly: it
// assumes both halves are present and would render "undefined lb × 5".
//
//   135 lb × 5    both halves
//   135 lb        a weight, reps left open
//   5 reps        reps, weight left open
//   null          no target at all -- render nothing, not an empty row
export function formatTarget({ targetWeight, targetReps, targetUnit } = {}) {
  const weight = targetWeight == null ? null : `${Number(targetWeight)} ${targetUnit || 'lb'}`;
  if (weight && targetReps != null) return `${weight} × ${targetReps}`;
  if (weight) return weight;
  if (targetReps != null) return `${targetReps} ${targetReps === 1 ? 'rep' : 'reps'}`;
  return null;
}
