import { useRef } from 'react';
import SectionLabel from '../shared/SectionLabel';
import { useAppState } from '../../context/AppStateContext';
import ExerciseSearchResults from '../shared/ExerciseSearchResults';
import Skeleton from '../shared/Skeleton';
import Input from '../shared/Input';
import EmptyState from '../shared/EmptyState';
import { IconDumbbell } from '../shared/icons';
import { searchExercises } from '../../utils/exerciseSearch';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

// The Log picker. By default it shows only this person's list -- the exercises they've
// favorited or logged a set for -- split into two headings: "Favorites" and "Other Previously
// Logged". Typing a search reveals the full catalog. Favoriting itself happens on the exercise
// detail screen, so the pills here are plain (tap to open).
export default function ExercisePicker({
  personExercises,
  catalog,
  routines,
  loading,
  onSelectExercise,
  onAddExercise,
  onStartRoutine,
  hasActiveRoutine,
}) {
  const { exerciseSearch, setExerciseSearch } = useAppState();
  const searchInputRef = useRef(null);
  const term = exerciseSearch.trim().toLowerCase();
  const searching = term.length > 0;

  // Default view: favorites first, then everything else the person has logged.
  const favorites = personExercises.filter((e) => e.isFavorite);
  const otherLogged = personExercises.filter((e) => !e.isFavorite);
  const groups = [];
  if (favorites.length > 0) groups.push({ id: 'favorites', name: 'Favorites', items: favorites });
  if (otherLogged.length > 0) groups.push({ id: 'other', name: 'Other Previously Logged', items: otherLogged });

  // Search view: ranked, token-based matching across the whole catalog.
  const searchResults = searching ? searchExercises(catalog, exerciseSearch) : [];

  const showRoutineQuickStart = !searching && !hasActiveRoutine && routines.length > 0;
  const hasList = personExercises.length > 0;

  return (
    <div>
      {showRoutineQuickStart && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel>Start a routine</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {routines.map((r) => (
              <button
                key={r.id}
                onClick={() => onStartRoutine(r)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 18px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>{r.name}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-accent-text)' }}>Start &rarr;</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showRoutineQuickStart && <SectionLabel>Or pick an exercise</SectionLabel>}

      {/* The app's most-used input, and it was the only one not going through the primitive: a
          hand-rolled copy of the same recipe that had drifted to a 14px radius and 14px/16px
          padding against `.input`'s --radius-md and --space-3/--space-4. The iOS 16px floor that
          used to be commented here is `.input`'s --text-md, where two e2e specs already assert it
          -- so it is now enforced rather than remembered. */}
      <Input
        ref={searchInputRef}
        data-tour-anchor={TOUR_ANCHORS.EXERCISE_SEARCH}
        value={exerciseSearch}
        onChange={(e) => setExerciseSearch(e.target.value)}
        // On mobile, the keyboard covers roughly the bottom half of the screen -- scrolling
        // the input to the top of the viewport on focus keeps it visible above the keyboard
        // and leaves the most possible room below it for search results.
        onFocus={() => {
          // jsdom (unit tests) doesn't implement scrollIntoView -- guard rather than skip this
          // entirely so real browsers still get it.
          if (searchInputRef.current?.scrollIntoView) searchInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        placeholder="Search all exercises"
        style={{
          marginBottom: 'var(--space-4)',
        }}
      />

      {loading && (
        <>
          <Skeleton width={84} height={12} style={{ marginBottom: 10 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            {[110, 140, 96].map((w, i) => (
              <Skeleton key={i} width={w} height={46} radius={16} />
            ))}
          </div>
        </>
      )}

      {/* Search results across the whole catalog */}
      {!loading && searching && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Search results</SectionLabel>
          <ExerciseSearchResults
            results={searchResults}
            term={exerciseSearch}
            onSelect={onSelectExercise}
            emptyMessage={`No exercises match "${exerciseSearch}". Try a shorter word, or add it as your own below.`}
          />
        </div>
      )}

      {/* Default view: Favorites + Other Previously Logged */}
      {!loading && !searching && (
        !hasList ? (
          // The first screen a brand-new person ever sees, and it was the barest empty state in the
          // app: centred grey text, no icon, no hierarchy. No action button here on purpose -- the
          // search field is directly above and "+ Add your own exercise" directly below, so a third
          // control would just be a duplicate of one of them.
          <EmptyState
            icon={IconDumbbell}
            title="Let's find your first exercise"
            body="Search the library above, or add your own at the bottom."
          />
        ) : (
          groups.map((group) => (
            <div key={group.id} style={{ marginBottom: 20 }}>
              <SectionLabel>{group.name}</SectionLabel>
              <div style={chipWrapStyle}>
                {group.items.map((ex) => (
                  <ExerciseChip key={ex.id} name={ex.name} onSelect={() => onSelectExercise(ex.id)} />
                ))}
              </div>
            </div>
          ))
        )
      )}

      {!loading && (
        <button
          onClick={() => onAddExercise(exerciseSearch)}
          data-tour-anchor={TOUR_ANCHORS.ADD_EXERCISE}
          style={addOwnButtonStyle}
        >
          + Add your own exercise
        </button>
      )}
    </div>
  );
}

function ExerciseChip({ name, onSelect }) {
  return (
    <button
      onClick={onSelect}
      style={{
        padding: '14px 18px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--color-text)',
        cursor: 'pointer',
      }}
    >
      {name}
    </button>
  );
}

const chipWrapStyle = { display: 'flex', flexWrap: 'wrap', gap: 10 };

const addOwnButtonStyle = {
  width: '100%',
  marginTop: 8,
  padding: 14,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};
