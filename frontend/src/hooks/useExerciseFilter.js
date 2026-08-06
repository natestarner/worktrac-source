import { useState } from 'react';

// Local-only filter state for History/PRs' ExerciseFilterBar. Deliberately NOT AppStateContext:
// requirement 5 ("filters clear on navigate-away") needs state that's simply gone on unmount, not
// persisted per keystroke to IndexedDB the way the Log picker's exerciseSearch is. Isolation
// across a PERSON switch (which doesn't unmount the route -- AppShell just navigates to that
// person's lastTab, which can be the same tab) comes from the call site remounting via
// key={activePersonId}, mirroring ExerciseDetail's own key={activePersonId} at LogTab.jsx -- so
// this hook itself takes no personId.
//
// initialExerciseFilter seeds a filter arriving via a deep link (ExerciseDetail's "View full
// history" link, a PR row tap). Consumed ONLY as a useState initializer, never re-applied on a
// later prop change, so the one-shot router-state seed in HistoryTab's wrapper can scrub itself
// (setSeed(null)) without this hook reacting to that scrub as if the filter should clear too.
export function useExerciseFilter(initialExerciseFilter = null) {
  const [text, setText] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState(() => new Set());
  const [exerciseFilter, setExerciseFilter] = useState(initialExerciseFilter);

  function toggleTag(tagId) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  function clearAll() {
    setText('');
    setSelectedTagIds(new Set());
    setExerciseFilter(null);
  }

  const isActive = !!(text.trim() || selectedTagIds.size || exerciseFilter);

  return { text, setText, selectedTagIds, toggleTag, exerciseFilter, setExerciseFilter, clearAll, isActive };
}
