import { comparableLb, epley } from './formulas';

// Client-side mirror of StatsService#getLastSession / #getBest
// (backend/.../stats/StatsService.java), computed over the already-warmed `history` query
// instead of a network round trip. `history` is unpaginated -- every session, every set -- so
// this produces the SAME answer as the server endpoint, not a degraded approximation. Used by
// ExerciseDetail.jsx as a fallback when the live exerciseSummary query has no data yet
// (offline, or lie-fi where the fetch is attempted but fails).
export function deriveExerciseSummaryFromHistory(history, exerciseId, excludeSessionId) {
  return {
    lastSession: deriveLastSession(history, exerciseId, excludeSessionId),
    best: deriveBest(history, exerciseId),
  };
}

function findEntry(session, exerciseId) {
  return session.entries.find((e) => e.exerciseId === exerciseId);
}

// Most recent *other* session (history is already ordered most-recent-first by the backend)
// whose entries include this exercise. Mirrors StatsService#getLastSession's exclusion.
function deriveLastSession(history, exerciseId, excludeSessionId) {
  for (const session of history || []) {
    if (excludeSessionId && session.id === excludeSessionId) continue;
    const entry = findEntry(session, exerciseId);
    if (entry) {
      return { sessionId: session.id, startedAt: session.startedAt, sets: entry.sets, note: entry.note ?? null };
    }
  }
  return null;
}

// Max estimated 1RM across every set ever logged for this exercise, regardless of session --
// mirrors StatsService#getBest, which never excludes a session either.
function deriveBest(history, exerciseId) {
  let best = null;
  let bestComparableLb = null;
  for (const session of history || []) {
    const entry = findEntry(session, exerciseId);
    if (!entry) continue;
    for (const set of entry.sets) {
      const candidateComparableLb = comparableLb(set.weight, set.reps, set.unit);
      if (bestComparableLb === null || candidateComparableLb > bestComparableLb) {
        bestComparableLb = candidateComparableLb;
        best = { weight: set.weight, reps: set.reps, unit: set.unit, sessionStartedAt: session.startedAt };
      }
    }
  }
  return best ? { ...best, est1rm: epley(best.weight, best.reps) } : null;
}
