import { matchesSearch } from './exerciseSearch';
import { rangesOverlap } from './dateRange';
import { toLocalDateStr } from './datetime';

// Pure filtering logic shared by History and PRs' ExerciseFilterBar. `tagsByExerciseId` comes
// from useExerciseTagMap.js's client-side join -- an exerciseId absent from it (a soft-deleted
// exercise History/PRs still shows rows for) simply has no tags, and can therefore never be
// matched by a tag filter, only by text. That's an accepted, permanent gap, not a bug.
//
// filter shape: { text: string, selectedTagIds: Set<number>, exerciseFilter: {exerciseId, ...} | null,
//                 dateRange: { from, to } | null }
//
// `dateRange` (History only -- see dateRange.js) picks whole SESSIONS: a workout matches when it
// was going on at any point during the searched days (sessionDaySpan overlaps the range). So a
// workout from 11:30 PM Friday to 12:40 AM Saturday is found by searching either day. A PR row
// has no session to date, so filterPrRows ignores it; PRs never sets one.

export function isFilterActive(filter) {
  return !!(hasEntryFilter(filter) || filter.dateRange);
}

// The filters that narrow WITHIN a session (which exercises show), as opposed to dateRange, which
// picks whole sessions.
function hasEntryFilter(filter) {
  return !!(filter.text?.trim() || filter.selectedTagIds?.size || filter.exerciseFilter);
}

// A copy of WorkoutSessionService.AUTOCLOSE, used only to bound an unfinished session below. It is
// a cap on how far a dot can spread, not a rule the client enforces, so drifting from the server's
// value would widen or narrow that cap and nothing else.
const OPEN_SESSION_SPAN_MS = 8 * 60 * 60 * 1000;

// The local days a session ran across, as a `{ from, to }` range.
//
// An UNFINISHED session (endedAt null) runs until now -- a workout started last night and still
// going this morning is part of today. But only up to 8 hours past its start: the server closes a
// stale session lazily, when that person's live workout is next READ, and History returns
// endedAt as stored. A son's workout left open, whose Log tab nobody opens for three weeks, would
// otherwise count as happening on every one of those days. History carries no lastActivityAt,
// so start + 8h is the closest honest bound.
//
// The end is the time `endedAt` records, which for a workout ended by tapping End is the TAP, not
// the last set -- so ending one at 12:10 AM files it under that day too. Accepted: knowing the
// last set's time needs per-set timestamps History does not carry.
export function sessionDaySpan(session, now = Date.now()) {
  const startMs = new Date(session.startedAt).getTime();
  const endMs = session.endedAt ? new Date(session.endedAt).getTime() : Math.min(now, startMs + OPEN_SESSION_SPAN_MS);
  const from = toLocalDateStr(session.startedAt);
  const to = toLocalDateStr(new Date(Math.max(startMs, endMs)).toISOString());
  return { from, to };
}

export function sessionMatchesDateRange(session, dateRange, now = Date.now()) {
  return !dateRange || rangesOverlap(sessionDaySpan(session, now), dateRange);
}

// Alphabetically-sorted, deduped tags actually present on the given exerciseIds -- NOT the full
// account tag vocabulary (useTags()), which is shared across the whole household and would
// otherwise show chips that filter this person's board down to zero results.
export function collectTagVocabulary(tagsByExerciseId, exerciseIds) {
  const byId = new Map();
  for (const exerciseId of exerciseIds) {
    for (const tag of tagsByExerciseId.get(exerciseId) || []) {
      byId.set(tag.id, tag);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// row needs only { exerciseId, exerciseName } -- both HistoryEntryDto and PrRowDto satisfy this
// directly, so callers can pass either without an adapter.
export function matchesFilter(row, filter, tagsByExerciseId) {
  if (filter.exerciseFilter && filter.exerciseFilter.exerciseId !== row.exerciseId) return false;
  if (filter.text && !matchesSearch(row.exerciseName, filter.text)) return false;
  if (filter.selectedTagIds?.size) {
    const tagIds = tagsByExerciseId.get(row.exerciseId) || [];
    const matchesAnySelected = tagIds.some((tag) => filter.selectedTagIds.has(tag.id));
    if (!matchesAnySelected) return false;
  }
  return true;
}

// Returns { session, entries } pairs -- entries filtered to matching exercises, sessions left
// with zero matching entries dropped. `session` is always the ORIGINAL, untransformed object (the
// exact reference from `history`) so a caller (HistoryTab's Edit button -> startEditingSession,
// which persists whatever it's given wholesale into AppStateContext) can never accidentally
// receive a filtered/truncated session.
export function filterHistorySessions(history, filter, tagsByExerciseId) {
  if (!isFilterActive(filter)) {
    return (history || []).map((session) => ({ session, entries: session.entries }));
  }
  const narrowEntries = hasEntryFilter(filter);
  const result = [];
  for (const session of history || []) {
    if (!sessionMatchesDateRange(session, filter.dateRange)) continue;
    const entries = narrowEntries
      ? session.entries.filter((entry) => matchesFilter(entry, filter, tagsByExerciseId))
      : session.entries;
    if (entries.length > 0) result.push({ session, entries });
  }
  return result;
}

export function filterPrRows(prs, filter, tagsByExerciseId) {
  if (!hasEntryFilter(filter)) return prs || [];
  return (prs || []).filter((pr) => matchesFilter(pr, filter, tagsByExerciseId));
}
