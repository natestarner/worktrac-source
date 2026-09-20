import { comparableValue, toLb } from './formulas';
import { sessionVolumeLb } from './prDetection';
import { SET_PR_TYPES, SESSION_PR_TYPES } from '../components/trends/exerciseMetrics';

// Per-set "which records was this when it was recorded" markers for History, computed entirely
// client-side over the already-warmed, unpaginated `history` query (every session, every set --
// see exerciseSummaryFromHistory.js for the same rationale: because history is unpaginated, this
// is the SAME answer a backend fold would give, not an approximation). That also means it works
// offline for free, with no second code path.
//
// A backend fold was deliberately rejected: WorkoutSessionService#getHistory groups sets by
// createdAt ASC, not startedAt -- a retroactively-logged ("Log a past workout") session has a
// LATE createdAt and an EARLY startedAt, so a fold reusing that list would compute "PR as of when
// you typed it in" and silently disagree with both History's own startedAt-DESC display order and
// StatsService#getExerciseTrend's own running-best fold (which folds by startedAt). Folding here,
// over `history`'s per-session entries re-sorted by startedAt, avoids that mismatch.
//
// Semantics mirror prDetection.js#setPrTypes: a record falls when the value is strictly greater
// than the running best AND greater than zero. Deliberately NOT formulas.js#isPrSet -- that has a
// +-0.5 tolerance answering "does this TIE the current all-time best", a different question;
// reusing it here would re-flag every repeat of an identical weight x reps as a new PR.
//
// Like StatsService#getExerciseTrend's isPr, this is recomputed from current data on every call --
// editing or deleting an old set retroactively changes which later sets were PRs. That's accepted,
// not a bug: nothing is persisted anywhere for "was a PR at the time it was recorded."
//
// ## Set-level vs session-level
//
// Est. 1RM and top weight belong to one SET, so they badge a set pill. Session volume belongs to
// the whole workout, so it badges the exercise ENTRY header instead -- no single set is the
// answer, and picking one would be a lie. Two lookups, one pass.
//
// Returns LOOKUPS (never a transformed copy of `history`) so callers can never accidentally pass
// an annotated/filtered session object to startEditingSession, which persists whatever it's given
// wholesale into AppStateContext.

// The per-measure value of one set, in a form that can be compared across units. Mirrors
// prDetection.js#SET_MEASURE_VALUE -- the two must agree, or History would star a row the
// celebration did not fire for.
const SET_MEASURE_VALUE = {
  est1rm: (set) => comparableValue(set),
  heaviest: (set) => toLb(Number(set?.weight) || 0, set?.unit || 'lb'),
};

export function buildHistoryPrFlags(history) {
  const setMarks = new Map();
  const sessionMarks = new Map();
  // history arrives startedAt DESC (most-recent-first, for display); the running-best fold needs
  // ascending order regardless of how the caller's array happens to be sorted.
  const sessions = [...(history || [])].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  // { [exerciseId]: { est1rm, heaviest } } -- one running best per measure per exercise.
  const runningBests = new Map();
  // { [exerciseId]: best session volume so far }, for the session-level marker.
  const runningSessionVolume = new Map();

  for (const session of sessions) {
    for (const entry of session.entries || []) {
      const best = runningBests.get(entry.exerciseId) || {};
      // entry.sets is already in createdAt-ascending (chronological) order -- it's grouped out of
      // WorkoutSessionService#getHistory's own createdAt-ASC set list -- so no further sort is
      // needed at the set level, only at the session level above.
      const marks = entry.sets.map((set) => {
        const taken = [];
        for (const type of SET_PR_TYPES) {
          const value = SET_MEASURE_VALUE[type](set);
          // `value > 0` is the same self-guarding rule prDetection uses: it is what stops every
          // bodyweight set claiming a top-weight record, with no exercise-type flag involved.
          if (!Number.isFinite(value) || value <= 0) continue;
          const prior = best[type];
          if (prior == null || value > prior) {
            best[type] = value;
            taken.push(type);
          }
        }
        return taken;
      });
      runningBests.set(entry.exerciseId, best);
      setMarks.set(historyPrFlagKey(session.id, entry.exerciseId), marks);

      // The session-level measure, folded over the same pass. Compared against every EARLIER
      // session only -- this session's own total is what is being tested, exactly as
      // prDetection.js#crossesSessionVolume requires of its prior best.
      const volume = sessionVolumeLb(entry.sets);
      const priorVolume = runningSessionVolume.get(entry.exerciseId);
      const sessionTaken = [];
      if (volume > 0 && (priorVolume == null || volume > priorVolume)) {
        runningSessionVolume.set(entry.exerciseId, volume);
        for (const type of SESSION_PR_TYPES) sessionTaken.push(type);
      }
      if (sessionTaken.length > 0) {
        sessionMarks.set(historyPrFlagKey(session.id, entry.exerciseId), sessionTaken);
      }
    }
  }

  return { setMarks, sessionMarks };
}

export function historyPrFlagKey(sessionId, exerciseId) {
  return `${sessionId}:${exerciseId}`;
}
