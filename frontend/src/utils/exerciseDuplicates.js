import { isTempExerciseId } from '../lib/exerciseIdMap';
import { FIELD_LIMITS } from './fieldLimits';

// What a set of an exercise measures. THE source for both the "Measured in" toggle in
// AddEditExerciseModal and the disambiguating suffix below, so the two can never drift: whatever
// label the person tapped is exactly the word that lands in the name.
export const MEASURE_OPTIONS = [
  { label: 'Reps', value: 'strength' },
  { label: 'Time', value: 'duration' },
];

const DEFAULT_TRACKING_TYPE = 'strength';

// exercises.name is NVARCHAR(200). ExerciseRequest now carries a matching @Size, so an over-long
// name is an honest 400 rather than what it used to be: a database error -> 503 ->
// shouldRetryWrite retries FOREVER, head-of-line-blocking the one serial outbox scope. That server
// cap is the backstop; this constant is still what keeps a real person from ever producing such a
// value, because a 400 on a durable write is DISCARDED and discarding is not much better than
// retrying forever. The suffix below must never be the thing that pushes a name over: see
// resolveExerciseCreate, which drops it rather than risk that. Also the input's maxLength.
// One source of truth with every other field cap, and with the backend's @Size on
// ExerciseRequest.name. Re-exported under its original name so the call sites that already
// import it from here keep working.
export const MAX_EXERCISE_NAME_LENGTH = FIELD_LIMITS.exerciseName;

export function measureLabel(trackingType) {
  const option = MEASURE_OPTIONS.find((o) => o.value === trackingType);
  return (option ?? MEASURE_OPTIONS[0]).label;
}

// Case-insensitive on purpose: SQL Server's default collation is case-insensitive, so this gives
// the same answer ExerciseService's own duplicate lookup does. Matching case-sensitively here would
// let "bench press" past the client check and then resolve to the existing "Bench Press" on sync --
// so the picker would show one row for an exercise the person was told they had just created.
function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

function trackingTypeOf(exercise) {
  return exercise?.trackingType || DEFAULT_TRACKING_TYPE;
}

// Which row wins when several match. Deterministic rather than "whichever came first in the array",
// because duplicates already exist in the data (nothing prevented them until now) and this feeds a
// navigation the person will keep landing on.
//
//   1. A real exercise beats an optimistic temp one -- a temp row's create can still fail, and a
//      real row is one the server has already confirmed.
//   2. The account's OWN exercise beats a global one -- a household that has its own "Bench Press"
//      beside the preloaded one has been logging against theirs.
//   3. Lowest id, so repeat lookups agree.
function preferredMatch(matches) {
  return matches.slice().sort((a, b) => {
    const byTemp = Number(isTempExerciseId(a.id)) - Number(isTempExerciseId(b.id));
    if (byTemp !== 0) return byTemp;
    const byGlobal = Number(!!a.isGlobal) - Number(!!b.isGlobal);
    if (byGlobal !== 0) return byGlobal;
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  })[0];
}

// Resolve what "Add <name>, measured in <trackingType>" should actually do, given everything the
// catalog currently holds. ONE derivation, feeding the modal's note, its primary button and its
// save handler, so those three can never disagree about the outcome.
//
// This is NOT a connectivity branch, so it earns no row on .claude/rules/resilience.md's register:
// it reads whatever queryKeys.exercises() holds, by the same code path in every mode. What varies
// while degraded is the CONTENT of that cache -- it may be older than the server, or on a device
// that has never warmed it, empty -- in which case this finds nothing and the create proceeds
// exactly as it does today. It degrades; it never blocks. ExerciseService.add applies the same rule
// server-side, and that is what converges a duplicate a stale cache could not see.
//
// Optimistic temp rows in the catalog count as matches on purpose: an exercise created moments ago
// and still queued in the outbox is a real duplicate as far as the person is concerned, and a temp
// id is selectable and loggable exactly like a real one.
export function resolveExerciseCreate({ catalog, name, trackingType }) {
  const trimmed = (name || '').trim();
  const measure = trackingType || DEFAULT_TRACKING_TYPE;
  const rows = catalog ?? [];
  if (!trimmed) return { kind: 'create', name: trimmed, clashWith: null };

  const sameName = (candidate) => {
    const key = normalizeName(candidate);
    return rows.filter((e) => normalizeName(e.name) === key);
  };
  const existing = (candidate) => {
    const matches = sameName(candidate).filter((e) => trackingTypeOf(e) === measure);
    return matches.length ? preferredMatch(matches) : null;
  };

  // Same name AND same measure -- this exercise already exists. Open it instead of making a second.
  const exact = existing(trimmed);
  if (exact) return { kind: 'open', exercise: exact };

  // Same name, other measure. Both are legitimate exercises, but the picker, History, PRs, Trends
  // and the routine strip all render bare names, so two identical ones are indistinguishable
  // everywhere at once. Suffix the NEW one with the measure just chosen; the existing exercise is
  // never touched -- renaming it would rewrite something the person already has sets and PRs
  // against, and rename is an online-only (Tier 3) write besides. This is the same call
  // V50__convert_seconds_exercises_to_duration.sql made: keep the names distinct rather than end up
  // with two identically-named rows in one picker.
  const clashes = sameName(trimmed);
  if (clashes.length === 0) return { kind: 'create', name: trimmed, clashWith: null };
  const clashWith = preferredMatch(clashes);

  const suffixed = `${trimmed} (${measureLabel(measure)})`;

  // Falling back to the unsuffixed name reproduces exactly today's behaviour (two rows sharing a
  // name), which is a cosmetic problem. Sending a name the column cannot hold is a wedged outbox.
  if (suffixed.length > MAX_EXERCISE_NAME_LENGTH) return { kind: 'create', name: trimmed, clashWith };

  // The suffixed name can itself already be taken: "Plank" (Reps) and "Plank (Time)" both exist and
  // the person types "Plank" with Time selected. Creating here would produce exactly the duplicate
  // this function exists to prevent, so fall through to opening it.
  const suffixedExisting = existing(suffixed);
  if (suffixedExisting) return { kind: 'open', exercise: suffixedExisting };

  return { kind: 'create', name: suffixed, clashWith };
}
