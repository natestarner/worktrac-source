import { useRef, useState } from 'react';
import SectionLabel from '../shared/SectionLabel';
import { useAppState } from '../../context/AppStateContext';
import ExerciseSearchResults from '../shared/ExerciseSearchResults';
import Skeleton from '../shared/Skeleton';
import Input from '../shared/Input';
import EmptyState from '../shared/EmptyState';
import { IconChevronDown, IconDumbbell } from '../shared/icons';
import { searchExercises } from '../../utils/exerciseSearch';
import { useChipRowOverflow } from '../../hooks/useChipRowOverflow';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

// How many routines the quick-start block offers before it collapses. Routines are full-width
// rows sitting ABOVE the search field, so this is the number that decides whether the rest of
// the picker starts below the fold.
const ROUTINE_PREVIEW_COUNT = 4;

// The Log picker. By default it shows only this person's list -- the exercises they've
// favorited or logged a set for -- split into two headings: "Favorites" and "Other Previously
// Logged". Typing a search reveals the full catalog. Favoriting itself happens on the exercise
// detail screen, so the pills here are plain (tap to open).
//
// Every list here is BOUNDED but never REORDERED, and the split matters. A picker list is read
// two ways: recognition ("get me to what's next") and retrieval ("where is Bulgarian Split
// Squat?"). Retrieval needs a position that is the same on every visit, which is why the
// alphabetical order the backend returns is preserved exactly and nothing is ranked by recency
// or frequency -- a list that re-sorts itself between visits cannot be learned. Bounding is the
// only lever applied, because it shortens the list without moving anything in it.
//
// Exercise groups are bounded by ROWS rather than by a count of items (see index.css's
// --picker-chip-rows): chips are variable-width, so a fixed item cap shows a wildly different
// amount of the list depending on how long someone's exercise names are, and a wider screen
// gets to show more items in the same nine rows for free.
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
  // Plain local state, not AppStateContext: LogTab mounts this component with
  // key={activePersonId}, so a person switch remounts it and these reset -- the same isolation
  // route useExerciseFilter takes on History/PRs. It also keeps "I expanded a list once" out of
  // the persisted schema, where it would be a PERSON_DEFAULTS migration for a preference that
  // shouldn't outlive the visit anyway.
  const [showAllRoutines, setShowAllRoutines] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const term = exerciseSearch.trim().toLowerCase();
  const searching = term.length > 0;

  // Default view: favorites first, then everything else the person has logged.
  const favorites = personExercises.filter((e) => e.isFavorite);
  const otherLogged = personExercises.filter((e) => !e.isFavorite);
  const groups = [];
  if (favorites.length > 0) groups.push({ id: 'favorites', name: 'Favorites', noun: 'favorites', items: favorites });
  if (otherLogged.length > 0) {
    groups.push({ id: 'other', name: 'Other Previously Logged', noun: 'exercises', items: otherLogged });
  }

  // Search view: ranked, token-based matching across the whole catalog.
  const searchResults = searching ? searchExercises(catalog, exerciseSearch) : [];

  const showRoutineQuickStart = !searching && !hasActiveRoutine && routines.length > 0;
  const hasList = personExercises.length > 0;
  const routinesOverflow = routines.length > ROUTINE_PREVIEW_COUNT;
  const visibleRoutines = showAllRoutines ? routines : routines.slice(0, ROUTINE_PREVIEW_COUNT);

  function toggleGroup(id) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {showRoutineQuickStart && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel style={sectionLabelSpacing}>Start a routine</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleRoutines.map((r) => (
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
          {routinesOverflow && (
            <ListDisclosure
              expanded={showAllRoutines}
              showLabel={`Show all ${routines.length} routines`}
              collapseLabel="Collapse routines"
              onToggle={() => setShowAllRoutines((v) => !v)}
            />
          )}
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
          <div className="picker-chip-wrap" style={{ marginBottom: 20 }}>
            {[110, 140, 96].map((w, i) => (
              <Skeleton key={i} width={w} height={46} radius={16} />
            ))}
          </div>
        </>
      )}

      {/* Search results across the whole catalog */}
      {!loading && searching && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel style={sectionLabelSpacing}>Search results</SectionLabel>
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
            <ChipGroup
              key={group.id}
              group={group}
              expanded={expandedGroups.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              onSelectExercise={onSelectExercise}
            />
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

// One bounded, alphabetical section of chips. The clip is CSS (.picker-chip-wrap--clipped), so
// the first paint is already the right height at any viewport width; useChipRowOverflow only
// reports whether anything is actually cut off and where the cut falls.
function ChipGroup({ group, expanded, onToggle, onSelectExercise }) {
  const wrapRef = useRef(null);
  const { overflowing, firstHiddenIndex } = useChipRowOverflow(wrapRef, !expanded, group.items.length);

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel style={sectionLabelSpacing}>{group.name}</SectionLabel>
      <div ref={wrapRef} className={`picker-chip-wrap${expanded ? '' : ' picker-chip-wrap--clipped'}`}>
        {group.items.map((ex, i) => (
          <ExerciseChip
            key={ex.id}
            name={ex.name}
            // A chip past the cut is clipped visually but still in the DOM -- which leaves it
            // focusable, in the accessibility tree, and passing Playwright's toBeVisible(). inert
            // is what makes it hidden to a keyboard and a screen reader too. It is preferred over
            // dropping the chip from the DOM because removing it would shrink the container below
            // its own cap and re-trigger the measurement (see useChipRowOverflow's header).
            hidden={!expanded && firstHiddenIndex >= 0 && i >= firstHiddenIndex}
            onSelect={() => onSelectExercise(ex.id)}
          />
        ))}
      </div>
      {/* Offered only once something is genuinely hidden. While expanded the control has to
          stay mounted regardless -- collapsing is the only way back, and `overflowing` reads
          false in that state precisely because nothing is clipped any more. */}
      {(overflowing || expanded) && (
        <ListDisclosure
          expanded={expanded}
          showLabel={`Show all ${group.items.length} ${group.noun}`}
          collapseLabel={`Collapse ${group.noun}`}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}

// The "there's more below" affordance, shared by the routine list and both chip groups so they
// cannot drift.
//
// It sits BELOW its list, not beside the section heading. Up in the header it read as decoration
// on a label rather than an action, and it was nowhere near the place the list actually stops --
// which is the whole thing it has to explain. The chevron carries most of that weight: the clip
// lands exactly on a row boundary, so a truncated list looks deliberately complete, with no
// half-row peeking out to suggest otherwise. Rotating it 180 degrees on expand is what makes
// collapsing read as the inverse of expanding rather than a second, unrelated control.
//
// The label is a DIRECT text-node child, deliberately not wrapped in a <span> beside the icon:
// RTL's getByText concatenates only direct text children, so wrapping it would silently break
// any getByText on these controls (frontend-core.md).
function ListDisclosure({ expanded, showLabel, collapseLabel, onToggle }) {
  return (
    <button onClick={onToggle} className="pressable" style={disclosureStyle} aria-expanded={expanded}>
      {expanded ? collapseLabel : showLabel}
      <IconChevronDown
        size={14}
        // `style` is spread over Icon's own, so the two layout properties it sets have to be
        // repeated here or the glyph loses them.
        style={{
          display: 'block',
          flexShrink: 0,
          transform: expanded ? 'rotate(180deg)' : 'none',
          transition: 'transform var(--dur-base) ease',
        }}
      />
    </button>
  );
}

function ExerciseChip({ name, hidden, onSelect }) {
  return (
    <button
      onClick={onSelect}
      className="picker-chip pressable"
      inert={hidden || undefined}
      // The chip truncates with an ellipsis at narrow widths (single-line height is what keeps
      // the row clipping exact), so the accessible name is pinned to the real name rather than
      // left to whatever the browser happens to render.
      aria-label={name}
      title={name}
    >
      {name}
    </button>
  );
}

const sectionLabelSpacing = { marginBottom: 'var(--space-2)' };

const disclosureStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  marginTop: 'var(--space-3)',
  background: 'none',
  border: 'none',
  padding: 'var(--space-1) 0',
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

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
