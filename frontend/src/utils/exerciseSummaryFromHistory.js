import { comparableValue, epley } from './formulas';

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

// Fold sets known only to this client -- optimistic rows and still-queued outbox writes -- into a
// best that came from server data.
//
// Neither source can see them on its own: queryClient.js only ever INVALIDATES `history` and
// `exerciseSummary` after a write, and invalidation is a no-op while a query is paused or its
// refetch is failing. So for a person's whole offline/lie-fi stretch the derived best freezes at
// the moment connectivity dropped while ExerciseDetail's displaySets keeps growing. Without this,
// the Log screen's PR pill compares each row against that frozen value -- and because isPrSet asks
// "does this TIE the all-time best" rather than "did this beat it", the result isn't merely a
// missing badge: a genuine offline PR goes unbadged while a later, lighter set that happens to tie
// the PRE-offline best gets badged instead.
//
// Ranks on comparableLb (never raw est1rm) so the weight-0 bodyweight guard is preserved, and uses
// strict `>` so an equal set never displaces the one already recorded -- same rules as deriveBest.
//
// Deliberately a max, so it can only ever RAISE the best. An offline DELETE (or downward edit) of
// an already-synced set that was the all-time best therefore still leaves the best stale-high
// until the outbox drains -- a known, accepted gap; see `.claude/rules/log-screen.md`.
// Ranks through comparableValue, so a hold is folded on its DURATION. Routing a hold through
// comparableLb instead would read its weight-0/reps-0 pair as a comparable of 0, the max would
// silently become a no-op, and the PR pill would land on the wrong row for the entire outage --
// the exact failure this function exists to prevent, just via a different measure.
export function mergeBestWithLocalSets(best, sets) {
  let merged = best ?? null;
  let mergedComparable = merged ? comparableValue(merged) : null;
  for (const set of sets || []) {
    const isHold = set?.durationSeconds != null;
    if (!isHold && (set?.weight == null || set?.reps == null)) continue;
    if (isHold && set?.weight == null) continue;
    const candidateComparable = comparableValue(set);
    if (mergedComparable === null || candidateComparable > mergedComparable) {
      mergedComparable = candidateComparable;
      // No sessionStartedAt -- a set that hasn't synced has no server session to date it by, and
      // the Log screen's Best card doesn't render one. The server best keeps its own fields
      // untouched whenever it wins, since it's returned as-is.
      //
      // est1rm is null for a hold: Epley over 0 reps is meaningless, and labelling seconds as a
      // weight is the mistake the weight-0 branch exists to avoid. Matches BestDto.
      merged = isHold
        ? { weight: set.weight, reps: 0, durationSeconds: set.durationSeconds, unit: set.unit || 'lb', est1rm: null }
        : { weight: set.weight, reps: set.reps, unit: set.unit || 'lb', est1rm: epley(set.weight, set.reps) };
    }
  }
  return merged;
}

// Max estimated 1RM across every set ever logged for this exercise, regardless of session --
// mirrors StatsService#getBest, which never excludes a session either.
function deriveBest(history, exerciseId) {
  let best = null;
  let bestComparable = null;
  for (const session of history || []) {
    const entry = findEntry(session, exerciseId);
    if (!entry) continue;
    for (const set of entry.sets) {
      const candidateComparable = comparableValue(set);
      if (bestComparable === null || candidateComparable > bestComparable) {
        bestComparable = candidateComparable;
        best = {
          weight: set.weight,
          reps: set.reps,
          durationSeconds: set.durationSeconds ?? null,
          unit: set.unit,
          sessionStartedAt: session.startedAt,
        };
      }
    }
  }
  if (!best) return null;
  // Mirrors BestDto: a hold has no est. 1RM.
  return { ...best, est1rm: best.durationSeconds != null ? null : epley(best.weight, best.reps) };
}
