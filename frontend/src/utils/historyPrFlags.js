import { comparableValue } from './formulas';

// Per-set "was this a PR at the time it was recorded" markers for History, computed entirely
// client-side over the already-warmed, unpaginated `history` query (every session, every set --
// see exerciseSummaryFromHistory.js for the same rationale: because history is unpaginated, this
// is the SAME answer a backend fold would give, not an approximation).
//
// A backend fold was deliberately rejected: WorkoutSessionService#getHistory groups sets by
// createdAt ASC, not startedAt -- a retroactively-logged ("Log a past workout") session has a
// LATE createdAt and an EARLY startedAt, so a fold reusing that list would compute "PR as of when
// you typed it in" and silently disagree with both History's own startedAt-DESC display order and
// StatsService#getExerciseTrend's own running-best fold (which folds by startedAt). Folding here,
// over `history`'s per-session entries re-sorted by startedAt, avoids that mismatch.
//
// Semantics mirror WorkoutSetService#insertSetAndDetectPr
// (backend/.../workoutset/WorkoutSetService.java): isPR = the running best is still empty, OR
// this set's comparableLb is STRICTLY greater than it. Deliberately NOT formulas.js's isPrSet --
// that has a +-0.5 tolerance answering "does this TIE the current all-time best", a different
// question; reusing it here would re-flag every repeat of an identical weight x reps as a new PR.
//
// Like StatsService#getExerciseTrend's isPr, this is recomputed from current data on every call --
// editing or deleting an old set retroactively changes which later sets were PRs. That's accepted,
// not a bug: nothing is persisted anywhere for "was a PR at the time it was recorded."
//
// Returns a LOOKUP (never a transformed copy of `history`) so callers can never accidentally pass
// an annotated/filtered session object to startEditingSession, which persists whatever it's given
// wholesale into AppStateContext.
export function buildHistoryPrFlags(history) {
  const flags = new Map();
  // history arrives startedAt DESC (most-recent-first, for display); the running-best fold needs
  // ascending order regardless of how the caller's array happens to be sorted.
  const sessions = [...(history || [])].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  const runningBestByExercise = new Map();

  for (const session of sessions) {
    for (const entry of session.entries || []) {
      let best = runningBestByExercise.has(entry.exerciseId) ? runningBestByExercise.get(entry.exerciseId) : null;
      // entry.sets is already in createdAt-ascending (chronological) order -- it's grouped out of
      // WorkoutSessionService#getHistory's own createdAt-ASC set list -- so no further sort is
      // needed at the set level, only at the session level above.
      const setFlags = entry.sets.map((set) => {
        const value = comparableValue(set);
        const isPr = best === null || value > best;
        if (isPr) best = value;
        return isPr;
      });
      runningBestByExercise.set(entry.exerciseId, best);
      flags.set(historyPrFlagKey(session.id, entry.exerciseId), setFlags);
    }
  }

  return flags;
}

export function historyPrFlagKey(sessionId, exerciseId) {
  return `${sessionId}:${exerciseId}`;
}
