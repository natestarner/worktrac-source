import { sessionVolumeLb, SET_MEASURE_VALUE } from './prDetection';
import { SET_PR_TYPES, SESSION_PR_TYPES } from '../components/trends/exerciseMetrics';

// Per-set "which records was this when it was recorded" markers, computed entirely client-side
// over the already-warmed, unpaginated `history` query (every session, every set -- see
// exerciseSummaryFromHistory.js for the same rationale: because history is unpaginated, this is
// the SAME answer a backend fold would give, not an approximation). That also means it works
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
// than the running best AND greater than zero. The two share their maths through
// prDetection.js#SET_MEASURE_VALUE and differ only in what "prior best" means -- the set before
// this one, versus the running best as of that point in history.
//
// Like StatsService#getExerciseTrend's isPr, this is recomputed from current data on every call --
// editing or deleting an old set retroactively changes which later sets were PRs. That's accepted,
// not a bug: nothing is persisted anywhere for "was a PR at the time it was recorded."
//
// ## THE LIVE SESSION FOLDS IN HERE TOO -- that is what makes the Log screen agree with History
//
// This is now the single derivation behind History's badges, the Log screen's set rows AND the
// "Session exercises" list. Before, the Log screen asked formulas.js#isPrSet ("is this my best",
// a +-0.5 TIE) while History asked this ("did this beat everything before it", a strict >), so
// hitting your best three times badged one row on History and pilled all three on Log -- one idea
// with two answers depending on the tab. There is now one answer.
//
// `liveSession` carries the in-progress workout, whose sets are NOT in `history` yet:
//
//   - Offline/lie-fi its `id` is null for the person's entire stretch (contextSessionId, see
//     .claude/rules/log-screen.md), so it is keyed under LIVE_SESSION_FLAG_KEY instead. Callers
//     must look it up the same way -- `historyPrFlagKey(sessionId ?? LIVE_SESSION_FLAG_KEY, ...)`.
//   - Its entries come from useSessionEntries / ExerciseDetail's displaySets, both of which
//     already merge still-queued writes off the MutationCache. So a record set in a gym basement
//     is badged immediately, by the same code path as one set online. This is deliberately NOT a
//     connectivity branch: nothing here reads useOnlineStatus, and the only thing that varies by
//     mode is the CONTENT of caches this already reads.
//   - Once that session syncs it appears in `history` too, so it is matched by id and REPLACED
//     rather than folded twice -- a double fold would compare the session against itself and
//     silently drop every mark it had just earned.
//
// ⚠️ `history` is Free-tier window-clamped and `exerciseSummary` (which the celebration reads) is
// not. So for a Free household whose all-time best predates the window, a badge can appear here
// without the celebration having fired. That divergence is pre-existing -- it was already true
// between History's badges and the celebration -- and is now visible on one more screen. Fixing it
// means clamping detection, which is the thing FreeTierHistoryWindowTest exists to prevent.
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

// The key a still-unsynced live session's marks are filed under. A session with no server id has
// no other stable identity, and `null` would collide with every other unsynced thing.
export const LIVE_SESSION_FLAG_KEY = 'live';

// A session with no startedAt is the live one before it has materialized -- chronologically last
// by definition. Sorting it with `new Date(undefined)` yields NaN, which makes the comparator
// non-transitive and the whole fold order-dependent.
function startedAtOrder(session) {
  const t = session?.startedAt ? new Date(session.startedAt).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export function buildHistoryPrFlags(history, { liveSession, exerciseId } = {}) {
  const setMarks = new Map();
  const sessionMarks = new Map();

  const sessions = [...(history || [])];
  if (liveSession?.entries?.length) {
    const live = {
      id: liveSession.id ?? LIVE_SESSION_FLAG_KEY,
      startedAt: liveSession.startedAt,
      entries: liveSession.entries,
    };
    // Match on a REAL id only: a null id must never match a history row's null-ish id.
    const at = liveSession.id == null ? -1 : sessions.findIndex((s) => s.id === liveSession.id);
    if (at >= 0) sessions[at] = live;
    else sessions.push(live);
  }
  // history arrives startedAt DESC (most-recent-first, for display); the running-best fold needs
  // ascending order regardless of how the caller's array happens to be sorted.
  sessions.sort((a, b) => startedAtOrder(a) - startedAtOrder(b));

  // { [exerciseId]: { est1rm, heaviest } } -- one running best per measure per exercise.
  const runningBests = new Map();
  // { [exerciseId]: best session volume so far }, for the session-level marker.
  const runningSessionVolume = new Map();

  for (const session of sessions) {
    for (const entry of session.entries || []) {
      // The Log screen only ever asks about the exercise on screen. Filtering here rather than at
      // the call site is what keeps this off the hot path as a whole-history walk -- the reason
      // an earlier version of this rule said not to put this derivation on the log screen at all.
      if (exerciseId != null && entry.exerciseId !== exerciseId) continue;
      const best = runningBests.get(entry.exerciseId) || {};
      // entry.sets is already in createdAt-ascending (chronological) order -- it's grouped out of
      // WorkoutSessionService#getHistory's own createdAt-ASC set list -- so no further sort is
      // needed at the set level, only at the session level above.
      const marks = (entry.sets || []).map((set) => {
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

// The key for the session a person is in right now, whether or not it has a server id yet.
export function liveSessionPrFlagKey(sessionId, exerciseId) {
  return historyPrFlagKey(sessionId ?? LIVE_SESSION_FLAG_KEY, exerciseId);
}
