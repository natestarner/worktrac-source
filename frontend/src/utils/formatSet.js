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
