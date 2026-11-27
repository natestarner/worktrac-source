import { useDeferredValue, useMemo, useState } from 'react';
import SectionLabel from '../shared/SectionLabel';
import ExerciseSearchResults from '../shared/ExerciseSearchResults';
import Skeleton from '../shared/Skeleton';
import Input from '../shared/Input';
import Button from '../shared/Button';
import { allSearchableExercises, searchExercises } from '../../utils/exerciseSearch';
import { ExercisePreviewSheet } from '../exercise/ExercisePreview';

// The Log tab's exercise search, as an ordinary SCREEN: the field at the top with Cancel beside
// it, and the results below it in normal document flow, scrolled by the page like every other
// screen. LogTab shows it in place of the Log page (which stays mounted, hidden), and AppShell hides
// its chrome while it is up.
//
// Why a screen and not a layer over the page: three designs before this one fought the iPhone
// keyboard and lost, all for the same reason -- the field the person had just tapped MOVED while
// the keyboard was opening (scrolled to, then lifted into a fixed layer). Here nothing moves: the
// field on the Log page is a button (ExercisePicker's SearchTrigger), and the tap that opens this
// screen focuses THIS field, already at the top, inside the tap's own click handler. That is the
// one place iOS raises the keyboard for a programmatic focus. Read
// docs/architecture/exercise-search-history.md before adding anything here that positions,
// sizes, locks or scrolls -- each of those was tried and is why the history doc exists.
//
// `fieldRef` is the field: LogTab focuses it in the tap.
//
// What is typed belongs to this screen and goes when it closes: Cancel (or Back) means "never
// mind", so the next search starts empty (Nate, 2026-11-27). It used to be the person's saved
// draft, kept across Cancel, a person switch and a reload, which made sense while the field sat on
// the Log page itself. On its own screen that kept text just read as stale. Choosing a result or
// "+ Add your own exercise" still carries the term to where it is needed.
export default function ExerciseSearchScreen({ fieldRef, catalog, loading, onSelectExercise, onAddExercise, onCancel }) {
  const [exerciseSearch, setExerciseSearch] = useState('');
  // "Preview exercise" on a result (its muscles and video before choosing it). Local: the screen
  // unmounts on close, and a preview never outlives the search it came from.
  const [preview, setPreview] = useState(null);
  // Nothing typed lists the whole library A-Z, to browse; typing narrows it to ranked matches.
  //
  // ⚠️ The list is drawn AFTER the tap, never inside it. LogTab opens this screen with flushSync and
  // focuses the field in the same click handler (that is what raises the iPhone keyboard), so
  // whatever this screen draws on mount is drawn before the field gets the focus. The whole library
  // is ~200 rows: drawn on mount it held the tap for 0.65-1.4s on a phone-speed CPU (Chromium,
  // 4-6x throttle, 2026-11-26), against ~80ms for the field alone. `useDeferredValue(true, false)`
  // mounts with the list off and draws it in a background render a moment later; the deferred term
  // keeps each keystroke from waiting on a long list too.
  const listShown = useDeferredValue(true, false);
  const term = useDeferredValue(exerciseSearch);
  const searching = term.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchExercises(catalog, term) : allSearchableExercises(catalog)),
    [searching, catalog, term],
  );

  function handleKeyDown(event) {
    // The keyboard's Search key puts the keyboard away, so every result can be seen. Scrolling the
    // results does not: the person may still be typing.
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
    // A hardware keyboard's Escape is Cancel.
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    // A region named "Exercise search", never "Search all exercises": Maestro matches labels, and
    // `tapOn: 'Search all exercises'` must find the Log page's button, not this whole screen.
    <section className="exercise-search-screen" aria-label="Exercise search">
      <div className="exercise-search-bar">
        {/* The primitive: `.input` holds the iOS 16px floor that keeps Safari from zooming on focus
            (two e2e specs assert it). */}
        <Input
          ref={fieldRef}
          value={exerciseSearch}
          onChange={(e) => setExerciseSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search all exercises"
          enterKeyHint="search"
          aria-label="Search all exercises"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button variant="ghost" onClick={onCancel} className="exercise-search-cancel">
          Cancel
        </Button>
      </div>

      <div className="exercise-search-body">
        {loading ? (
          <Skeleton width="100%" height={46} radius={16} style={sectionSpacing} />
        ) : listShown ? (
          <>
            {!searching && (
              <p className="exercise-search-hint">Search by name, another name for it, or a muscle it works.</p>
            )}
            <div style={sectionSpacing}>
              <SectionLabel style={sectionLabelSpacing}>{searching ? 'Search results' : 'All exercises'}</SectionLabel>
              <ExerciseSearchResults
                results={results}
                term={term}
                onSelect={onSelectExercise}
                onPreview={(ex) => setPreview({ id: ex.id, name: ex.name })}
                emptyMessage={
                  searching
                    ? `No exercises match "${term}". Try a shorter word, or add it as your own below.`
                    : 'No exercises yet. Add your own below.'
                }
              />
            </div>
          </>
        ) : null}
        {/* With the list, so it does not draw at the top and then jump below it. */}
        {!loading && listShown && (
          <Button onClick={() => onAddExercise(exerciseSearch)} fullWidth>
            + Add your own exercise
          </Button>
        )}
      </div>

      {preview && <ExercisePreviewSheet exerciseId={preview.id} exerciseName={preview.name} onClose={() => setPreview(null)} />}
    </section>
  );
}

// The screen's two vertical rhythms, the same as the picker's (design-system.md, "Vertical
// rhythm"): a heading sits --space-2 above what it heads, one block --space-5 above the next.
const sectionLabelSpacing = { marginBottom: 'var(--space-2)' };
const sectionSpacing = { marginBottom: 'var(--space-5)' };
