import { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import SectionLabel from '../shared/SectionLabel';
import ExerciseSearchResults from '../shared/ExerciseSearchResults';
import Skeleton from '../shared/Skeleton';
import Input from '../shared/Input';
import Button from '../shared/Button';
import { searchExercises } from '../../utils/exerciseSearch';
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
export default function ExerciseSearchScreen({ fieldRef, catalog, loading, onSelectExercise, onAddExercise, onCancel }) {
  const { exerciseSearch, setExerciseSearch } = useAppState();
  // "Preview exercise" on a result (its muscles and video before choosing it). Local: the screen
  // unmounts on close, and a preview never outlives the search it came from.
  const [preview, setPreview] = useState(null);
  const searching = exerciseSearch.trim().length > 0;
  const results = searching ? searchExercises(catalog, exerciseSearch) : [];

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
        ) : searching ? (
          <div style={sectionSpacing}>
            <SectionLabel style={sectionLabelSpacing}>Search results</SectionLabel>
            <ExerciseSearchResults
              results={results}
              term={exerciseSearch}
              onSelect={onSelectExercise}
              onPreview={(ex) => setPreview({ id: ex.id, name: ex.name })}
              emptyMessage={`No exercises match "${exerciseSearch}". Try a shorter word, or add it as your own below.`}
            />
          </div>
        ) : (
          <p className="exercise-search-hint">Search by name, another name for it, or a muscle it works.</p>
        )}
        {!loading && (
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
