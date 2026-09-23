import { convertWeight, lbE7 } from './formulas';
import { formatRestTime } from './datetime';

// THE definition of "volume" for the session-volume record, on the client. Every consumer -- the
// celebration (ExerciseDetail#handleLogSet), History's and the Log screen's record badges
// (historyPrFlags.js), the offline summary fallback (exerciseSummaryFromHistory.js), the PRs board,
// the records table and the Trends chart -- reads it from here and nowhere else.
//
// Its server twin is backend/.../stats/SessionVolume.java. The two are pinned to each other by
// shared/record-rules/session-volume-cases.json, which BOTH test suites run (sessionVolume.test.js
// and SessionVolumeTest.java) -- so changing the rule on one side without the other fails a build
// rather than quietly making the celebration disagree with the PRs board.
//
// ## One measure per exercise, in that exercise's own unit
//
//   'seconds'  a duration-tracked exercise (plank, wall sit): total seconds held. Added load does
//              not enter it, for the same reason it does not enter a hold's est.-1RM stand-in --
//              a load-adjusted hold needs the person's bodyweight, which the app doesn't store.
//   'reps'     a rep exercise where EVERY set considered is at weight 0 (pull-ups, push-ups):
//              total reps. weight x reps is 0 for every one of those sets, so a pounds volume
//              was a flat zero and the record could never fire at all.
//   'load'     anything else: weight x reps in pounds, summed.
//
// The kind is decided over the exercise's WHOLE set list, never per session and never per set.
// Per-set would add reps to pounds; per-session would rank a 40-rep day against a 3000 lb day. The
// consequence -- deliberate, and the same "recomputed from current data" rule historyPrFlags.js
// already accepts -- is that the first time someone puts 10 lb on a pull-up, the exercise becomes
// 'load' and every earlier (unloaded) session is re-read as 0 lb.

export const VOLUME_KINDS = ['load', 'reps', 'seconds'];

function isHold(set) {
  return set?.durationSeconds != null;
}

function isUnloaded(set) {
  return (Number(set?.weight) || 0) === 0;
}

// The kind of a set list, or null for an empty one (nothing logged yet has no measure).
export function volumeKindOf(sets) {
  const list = (sets || []).filter(Boolean);
  if (list.length === 0) return null;
  if (list.some(isHold)) return 'seconds';
  return list.every(isUnloaded) ? 'reps' : 'load';
}

// Combine the kind of one set list with the kind of more sets from the same exercise -- e.g. the
// server's answer over synced history plus today's still-unsynced sets. Equivalent to
// volumeKindOf(a ∪ b) without needing the sets behind `a`: seconds wins outright (it is a property
// of the exercise), and one loaded set anywhere makes the whole exercise 'load'.
export function mergeVolumeKinds(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  if (a === 'seconds' || b === 'seconds') return 'seconds';
  if (a === 'load' || b === 'load') return 'load';
  return 'reps';
}

// One set's contribution in the kind's unit, scaled so pounds stay an exact integer (x 1e7 --
// see formulas.js#lbE7). The load half is the same weight formulas.js#weightLb ranks top weight on.
function setVolumeScaled(set, kind) {
  if (!set) return 0;
  if (kind === 'seconds') {
    const seconds = Number(set.durationSeconds);
    return Number.isFinite(seconds) ? seconds : 0;
  }
  const reps = Number(set.reps);
  if (!Number.isFinite(reps)) return 0;
  if (kind === 'reps') return reps;
  const weight = Number(set.weight);
  if (!Number.isFinite(weight)) return 0;
  return lbE7(weight, set.unit || 'lb') * reps;
}

const LOAD_SCALE = 1e7;

// One set's contribution to a session's volume, in the kind's unit.
export function setVolume(set, kind) {
  const scaled = setVolumeScaled(set, kind);
  return volumeIsWeight(kind) ? scaled / LOAD_SCALE : scaled;
}

// A session's volume for one exercise. `kind` defaults to the kind of these sets alone, which is
// only right when they ARE the exercise's whole history -- every real consumer passes the kind it
// decided over the full set list.
//
// Pounds are summed as exact integers and divided ONCE, so the total is the nearest double to the
// same exact decimal SessionVolume.java's BigDecimal sum produces -- the server sends its prior best
// unrounded, and a repeat of that exact workout must TIE it here, not beat it by a rounding hair.
export function sessionVolume(sets, kind = volumeKindOf(sets)) {
  let total = 0;
  for (const set of sets || []) total += setVolumeScaled(set, kind);
  return volumeIsWeight(kind) ? total / LOAD_SCALE : total;
}

// Does a session with this volume take the record from `priorBest` (the best of every EARLIER
// session, in the same kind)?
//
// ⚠️ A null prior means there IS no earlier session, and that is a baseline, not a record: the
// first workout of an exercise is trivially its biggest, so marking it said nothing. Set-level
// records (est. 1RM, top weight) still mark a first set -- only the session total waits for a
// second workout to have something to beat. `volume > 0` keeps a session of failed sets from
// taking a record of zero.
export function takesSessionVolumeRecord(volume, priorBest) {
  if (priorBest == null || !Number.isFinite(Number(priorBest))) return false;
  if (!Number.isFinite(volume) || volume <= 0) return false;
  return volume > Number(priorBest);
}

// Whether logging this set is the moment today's running total takes the record.
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
// `priorBest` must EXCLUDE the current session, or the record chases itself: after the crossing
// the current session becomes the best, `before <= prior` goes true again, and the next set
// re-fires. Both sources exclude it -- online via getSummary's excludeSessionId, offline by
// dropping sessions at or after the live session's startedAt. The first-workout rule is
// takesSessionVolumeRecord's, so the celebration and the badges cannot disagree on it.
export function crossesSessionVolume(volumeBefore, volumeAfter, priorBest) {
  if (!Number.isFinite(volumeBefore)) return false;
  if (!takesSessionVolumeRecord(volumeAfter, priorBest)) return false;
  return volumeBefore <= Number(priorBest);
}

// The prior best session volume, re-expressed in `kind`, from an exercise summary (the server's
// ExerciseSummaryDto or exerciseSummaryFromHistory's offline equivalent). Null means "no earlier
// session" -- or that this summary cannot say, which withholds the record rather than inventing one.
//
// The one translation that exists: the summary saw only unloaded sets ('reps') and the sets since
// include a loaded one ('load'). Every earlier set was then at weight 0, so every earlier session
// is exactly 0 lb -- the prior is 0 if an earlier session exists and null if none does. 'seconds'
// never changes (it is the exercise's tracking type) and 'load' never reverts to 'reps' (a loaded
// set cannot be un-logged by logging another).
//
// A summary with no volumeKind was cached before this rule shipped. Its bestSessionVolumeLb was
// always weight x reps in pounds, which is exactly this 'load' -- and says nothing for 'reps' or
// 'seconds', so those get null rather than a pounds figure compared against reps.
export function priorSessionVolume(summary, kind) {
  if (!summary || kind == null) return null;
  const summaryKind = summary.volumeKind ?? (summary.bestSessionVolumeLb !== undefined ? 'load' : null);
  const raw = summary.volumeKind != null ? summary.bestSessionVolume : summary.bestSessionVolumeLb;
  const best = raw == null ? null : Number(raw);
  if (best == null || !Number.isFinite(best)) return null;
  if (summaryKind === kind) return best;
  if (summaryKind === 'reps' && kind === 'load') return 0;
  return null;
}

// The value PERSON_DEFAULTS.volumePrCelebrated last latched for an exercise, if it was latched in
// `kind`. Entries are `{ kind, value }`; a bare number was written before volume had kinds, when
// it could only ever be pounds. A latch in another kind says nothing: the first loaded pull-up
// re-reads the exercise in pounds, and a high-water mark of 40 REPS must not suppress every
// genuine pounds record below 40 lb.
export function latchedVolume(entry, kind) {
  if (entry == null) return null;
  if (typeof entry === 'number') return kind === 'load' ? entry : null;
  return entry.kind === kind && Number.isFinite(entry.value) ? entry.value : null;
}

// The kind a server DTO's volume figure is in. Every DTO that carries a volume now carries its
// kind beside it (PrRowDto, ExerciseRecordsDto, ExerciseSummaryDto), so a number and its unit
// cannot be separated. One cached before that has none, and its volumes were always pounds.
export function dtoVolumeKind(dto) {
  return dto?.volumeKind ?? 'load';
}

// How a volume reads. Rounded and unseparated for pounds -- the PRs board and the records table
// render the same record, and a thousands separator on one would make them look like two numbers.
export function formatVolume(value, kind, defaultUnit) {
  const n = Number(value) || 0;
  if (kind === 'seconds') return formatRestTime(Math.round(n));
  if (kind === 'reps') return `${Math.round(n)} ${Math.round(n) === 1 ? 'rep' : 'reps'}`;
  return `${Math.round(convertWeight(n, 'lb', defaultUnit))} ${defaultUnit}`;
}

// Whether a volume in this kind is a weight (so a kg household converts it) -- the Trends chart's
// per-exercise override of EXERCISE_METRICS.sessionVolume.isWeight.
export function volumeIsWeight(kind) {
  return kind !== 'reps' && kind !== 'seconds';
}
