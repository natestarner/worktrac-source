import { comparableValue, epley, weightLb } from './formulas';
import { sessionVolume, volumeKindOf } from './sessionVolume';

// Client-side mirror of StatsService#getLastSession / #getBest
// (backend/.../stats/StatsService.java), computed over the already-warmed `history` query
// instead of a network round trip. `history` is unpaginated -- every session, every set -- so
// this produces the SAME answer as the server endpoint, not a degraded approximation. Used by
// ExerciseDetail.jsx as a fallback when the live exerciseSummary query has no data yet
// (offline, or lie-fi where the fetch is attempted but fails).
export function deriveExerciseSummaryFromHistory(history, exerciseId, excludeSessionId, liveSessionStartedAt) {
  return {
    lastSession: deriveLastSession(history, exerciseId, excludeSessionId),
    best: deriveBest(history, exerciseId),
    heaviestWeightLb: deriveHeaviestWeightLb(history, exerciseId),
    ...deriveBestSessionVolume(history, exerciseId, excludeSessionId, liveSessionStartedAt),
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
// the Log screen's record badges compare each row against that frozen value: a genuine offline PR
// goes unbadged while the running best it should have raised stays where it was. (Before the Log
// screen moved onto History's predicate this was worse than a missing badge -- the old isPrSet
// asked "does this TIE the all-time best", so a later, lighter set that happened to tie the
// PRE-offline best got badged instead.)
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
export function mergeBestWithLocalSets(best, sets, localSessionStartedAt) {
  let merged = best ?? null;
  let mergedComparable = merged ? comparableValue(merged) : null;
  for (const set of sets || []) {
    const isHold = set?.durationSeconds != null;
    if (!isHold && (set?.weight == null || set?.reps == null)) continue;
    if (isHold && set?.weight == null) continue;
    const candidateComparable = comparableValue(set);
    if (mergedComparable === null || candidateComparable > mergedComparable) {
      mergedComparable = candidateComparable;
      // A set that hasn't synced has no SERVER session to date it by, but it does have a date:
      // it was logged into the session happening right now. `localSessionStartedAt` carries that,
      // falling back to now for the offline stretch where the session itself has no id or start
      // yet. The Best card renders this date, so leaving it undefined would blank the one field
      // that says WHEN -- and blank it precisely for the record you just set. The server best
      // keeps its own fields untouched whenever it wins, since it's returned as-is.
      //
      // est1rm is null for a hold: Epley over 0 reps is meaningless, and labelling seconds as a
      // weight is the mistake the weight-0 branch exists to avoid. Matches BestDto.
      const startedAt = localSessionStartedAt ?? new Date().toISOString();
      merged = isHold
        ? { weight: set.weight, reps: 0, durationSeconds: set.durationSeconds, unit: set.unit || 'lb', est1rm: null, sessionStartedAt: startedAt }
        : { weight: set.weight, reps: set.reps, unit: set.unit || 'lb', est1rm: epley(set.weight, set.reps), sessionStartedAt: startedAt };
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

// ⚠️ The two measures below exclude the CURRENT session differently, and the asymmetry is
// load-bearing. It mirrors StatsService#getSummary exactly -- see ExerciseSummaryDto's header for
// the same table.
//
//   heaviestWeightLb      all-time, INCLUDING today. A set PR asks "did this beat everything
//                         before it", and earlier sets logged today count as before it.
//   bestSessionVolume     EXCLUDES the current session. The current session's running total is the
//                         thing being tested, so including it makes the record chase itself: after
//                         the crossing, today becomes the best, `before <= prior` goes true again
//                         and the next set re-fires.
//
// The live query passes an id; this offline fallback cannot, because contextSessionId is null for
// a person's whole outage. It excludes by START TIME instead, which works in every mode because
// logSetMutation.onMutate seeds the provisional session with a real
// `{ id: null, startedAt: clientLoggedAt }` even when the id is not yet known.

// Heaviest raw weight ever put on this exercise, in pounds (formulas.js#weightLb, the one top-weight
// measure). Mirrors getSummary's heaviestWeightLb. Returns null when nothing has been logged, which
// prDetection reads as "no prior best" rather than as zero.
function deriveHeaviestWeightLb(history, exerciseId) {
  let heaviest = null;
  for (const session of history || []) {
    const entry = findEntry(session, exerciseId);
    if (!entry) continue;
    for (const set of entry.sets) {
      const lb = weightLb(set);
      if (heaviest === null || lb > heaviest) heaviest = lb;
    }
  }
  return heaviest;
}

// Biggest single-session volume for this exercise across every session OTHER than the one in
// progress -- see the asymmetry note above -- together with the kind it is measured in. Mirrors
// ExerciseSummaryDto's bestSessionVolume + volumeKind: the kind is decided over EVERY session
// (including the live one, as the server does), the best over the earlier ones only.
function deriveBestSessionVolume(history, exerciseId, excludeSessionId, liveSessionStartedAt) {
  const allSets = [];
  for (const session of history || []) {
    const entry = findEntry(session, exerciseId);
    if (entry) allSets.push(...entry.sets);
  }
  const volumeKind = volumeKindOf(allSets);

  const liveStartedMs = liveSessionStartedAt ? new Date(liveSessionStartedAt).getTime() : null;
  let best = null;
  for (const session of history || []) {
    if (excludeSessionId && session.id === excludeSessionId) continue;
    // Offline the id is unavailable, so fall back to time: anything that started at or after the
    // live session's start IS the live session (or newer), never a past one to compare against.
    if (liveStartedMs !== null && Number.isFinite(liveStartedMs)) {
      const startedMs = new Date(session.startedAt).getTime();
      if (Number.isFinite(startedMs) && startedMs >= liveStartedMs) continue;
    }
    const entry = findEntry(session, exerciseId);
    if (!entry) continue;
    const total = sessionVolume(entry.sets, volumeKind);
    if (best === null || total > best) best = total;
  }
  return { bestSessionVolume: best, volumeKind };
}

// Fold client-only sets into the all-time heaviest, for the same reason mergeBestWithLocalSets
// exists: `history` and `exerciseSummary` are only ever invalidated after a write, and an
// invalidation is a no-op while paused, so both freeze for a person's whole outage while
// displaySets keeps growing. Without this, a top-weight PR logged offline would go uncelebrated
// and then the NEXT, lighter set would be celebrated against the frozen value.
//
// A max, so it can only ever raise the best -- an offline delete of the heaviest set leaves it
// stale-high until the outbox drains. Same known, accepted gap as mergeBestWithLocalSets.
export function mergeHeaviestWithLocalSets(heaviestLb, sets) {
  let merged = heaviestLb ?? null;
  for (const set of sets || []) {
    if (set?.weight == null) continue;
    const lb = weightLb(set);
    if (merged === null || lb > merged) merged = lb;
  }
  return merged;
}
