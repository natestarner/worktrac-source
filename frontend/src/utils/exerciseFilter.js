import { matchesSearch } from './exerciseSearch';

// Pure filtering logic shared by History and PRs' ExerciseFilterBar. `tagsByExerciseId` comes
// from useExerciseTagMap.js's client-side join -- an exerciseId absent from it (a soft-deleted
// exercise History/PRs still shows rows for) simply has no tags, and can therefore never be
// matched by a tag filter, only by text. That's an accepted, permanent gap, not a bug.
//
// filter shape: { text: string, selectedTagIds: Set<number>, exerciseFilter: {exerciseId, ...} | null }

export function isFilterActive(filter) {
  return !!(filter.text?.trim() || filter.selectedTagIds?.size || filter.exerciseFilter);
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
  const result = [];
  for (const session of history || []) {
    const entries = session.entries.filter((entry) => matchesFilter(entry, filter, tagsByExerciseId));
    if (entries.length > 0) result.push({ session, entries });
  }
  return result;
}

export function filterPrRows(prs, filter, tagsByExerciseId) {
  if (!isFilterActive(filter)) return prs || [];
  return (prs || []).filter((pr) => matchesFilter(pr, filter, tagsByExerciseId));
}
