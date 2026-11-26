import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import SectionLabel from '../shared/SectionLabel';
import { useAppState } from '../../context/AppStateContext';
import ExerciseSearchResults from '../shared/ExerciseSearchResults';
import Skeleton from '../shared/Skeleton';
import Input from '../shared/Input';
import Button from '../shared/Button';
import EmptyState from '../shared/EmptyState';
import { IconChevronDown, IconDumbbell } from '../shared/icons';
import { searchExercises } from '../../utils/exerciseSearch';
import { useChipRowOverflow } from '../../hooks/useChipRowOverflow';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';
import { ExercisePreviewSheet } from '../exercise/ExercisePreview';
import { installFocusTrap } from '../../lib/focusTrap';
import { lockBodyScroll } from '../../lib/bodyScrollLock';

// How many routines the quick-start block offers before it collapses. Routines are full-width
// rows sitting ABOVE the search field, so this is the number that decides whether the rest of
// the picker starts below the fold.
const ROUTINE_PREVIEW_COUNT = 4;

// How far a finger may travel between touchstart and touchend and still be a tap on the search
// field rather than a scroll of the page that happened to start on it.
const TAP_SLOP_PX = 10;

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
  // The search result being previewed ("Preview exercise": its muscles and video, before choosing
  // it). Local for the same reason as the two above: a person switch remounts this component.
  const [preview, setPreview] = useState(null);
  const term = exerciseSearch.trim().toLowerCase();
  const searching = term.length > 0;
  // The full-screen search layer (`.exercise-search-layer`, like iOS Mail's and Music's search).
  // Tapping the field opens it: the field is pinned at the top of what is visible, results scroll
  // beneath it inside the layer, and Cancel closes it. Nothing about the PAGE scrolls or changes
  // size, so there is nothing for the keyboard's resize to clamp or race (#626: builds 34-36 each
  // patched a scroll-the-page-to-the-field approach, and on the simulator the page still refused to
  // move about half the time). Opened only by a tap (focus), never by itself: a search restored by
  // a person switch or a reload sits in the field, and one tap brings its results back.
  const [searchOpen, setSearchOpen] = useState(false);
  // The height the field occupied in the page, held while it is lifted out into the layer, so
  // nothing below it moves up behind the layer (and nothing jumps when it comes back down).
  const [slotHeight, setSlotHeight] = useState(null);
  const slotRef = useRef(null);
  const layerRef = useRef(null);
  const resultsRef = useRef(null);
  const touchStartRef = useRef(null);

  function openSearch() {
    if (searchOpen) return;
    setSlotHeight(slotRef.current?.offsetHeight || null);
    setSearchOpen(true);
  }

  // A TAP opens the layer BEFORE the field takes focus, then focuses it where it now is, at the top.
  // Left to the browser, iOS focuses the field at its place mid-page and Safari starts panning the
  // page to reveal it; a frame later the field is lifted to the top of a fixed layer, and the pan
  // carries the layer with it (the 2026-11-26 flicker). Cancelling the touchend stops the browser's
  // own focus and click (which would otherwise land on whatever the layer now puts under the
  // finger); the focus() here, inside the touch handler, is a user gesture, so iOS still raises
  // the keyboard. A drag that starts on the field is a scroll of the page and is left alone; so is
  // a touchend the browser will not let us cancel (it is ending a scroll). Mouse, keyboard and
  // Playwright's fill() still open it through onFocus.
  function handleTouchStart(event) {
    const touch = event.touches[0];
    touchStartRef.current = searchOpen || !touch ? null : { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const touch = event.changedTouches[0];
    if (searchOpen || !start || !touch || !event.cancelable) return;
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP_PX) return;
    event.preventDefault();
    flushSync(openSearch);
    searchInputRef.current?.focus({ preventScroll: true });
  }

  // Cancel (and Escape): close the layer and take the keyboard down (the blur). The typed text is
  // KEPT, unlike iOS's own Cancel: it is this person's draft (AppStateContext, per person), which
  // must survive a person switch (frontend-core.md), and the person bar is under the layer -- so a
  // Cancel that cleared it would make that impossible. Tapping the field again brings the results
  // back; clearing is deleting the text.
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchInputRef.current?.blur();
  }, []);

  function selectFromSearch(exerciseId) {
    setSearchOpen(false);
    onSelectExercise(exerciseId);
  }

  // While the layer is up it behaves like a dialog: the page behind can't scroll, Tab stays inside
  // it, and Escape is the keyboard's Cancel. Same two modules Modal and the tour use; the scroll
  // lock's touch guard means a finger drag can scroll the results and nothing else -- on iOS,
  // `overflow: hidden` alone still let a drag pan the page behind the layer.
  useEffect(() => {
    const layer = layerRef.current;
    const results = resultsRef.current;
    if (!searchOpen || !layer || !results) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeSearch();
      }
    }
    layer.addEventListener('keydown', onKeyDown);
    const uninstallFocusTrap = installFocusTrap(layer);
    const unlockBodyScroll = lockBodyScroll({ guardTouch: true });
    // One line of evidence for the simulator flow (09-search-focus-holds) and Safari's Web
    // Inspector: where the field landed and whether the layer is the visible viewport.
    const frame = requestAnimationFrame(() => {
      const field = searchInputRef.current?.getBoundingClientRect();
      console.info(
        `[keyboard] search layer open (field top ${Math.round(field?.top ?? -1)}, layer ${Math.round(layer.getBoundingClientRect().height)} of window ${window.innerHeight})`,
      );
    });
    const stopEvidence = logSearchEvidence(layer, results);
    return () => {
      cancelAnimationFrame(frame);
      stopEvidence();
      layer.removeEventListener('keydown', onKeyDown);
      uninstallFocusTrap();
      unlockBodyScroll();
    };
  }, [searchOpen, closeSearch]);

  // ⚠️ Nothing on the PAGE changes when a search starts or ends. The routine quick-start block and
  // "Or pick an exercise" used to be hidden while searching, which moved the field up under the
  // person's thumb on the first letter typed (2026-11-08). Results now live in the layer, so the
  // page under it is exactly what it was before the tap, and is still there when Cancel closes it.

  // Default view: favorites first, then everything else the person has logged.
  const favorites = personExercises.filter((e) => e.isFavorite);
  const otherLogged = personExercises.filter((e) => !e.isFavorite);
  const groups = [];
  if (favorites.length > 0) groups.push({ id: 'favorites', name: 'Favorites', noun: 'favorites', items: favorites });
  if (otherLogged.length > 0) {
    groups.push({ id: 'other', name: 'Previously Logged', noun: 'exercises', items: otherLogged });
  }

  // Search view: ranked, token-based matching across the whole catalog.
  const searchResults = searching ? searchExercises(catalog, exerciseSearch) : [];

  // Not gated on `searching` -- see the warning above.
  const showRoutineQuickStart = !hasActiveRoutine && routines.length > 0;
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
      {/* Above the field: covered by the layer while it is open, so hidden the same way as the
          page below it. */}
      <div aria-hidden={searchOpen || undefined} inert={searchOpen || undefined}>
      {showRoutineQuickStart && (
        <div style={sectionSpacing}>
          <SectionLabel style={sectionLabelSpacing}>Start a routine</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
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

      {showRoutineQuickStart && <SectionLabel style={sectionLabelSpacing}>Or pick an exercise</SectionLabel>}
      </div>

      {/* The field's place in the page. While the layer is open the field is lifted out of it (the
          same <input>, so focus and the keyboard stay put) and this holds its height. */}
      <div ref={slotRef} style={{ ...sectionSpacing, minHeight: searchOpen && slotHeight ? slotHeight : undefined }}>
        <div
          ref={layerRef}
          className={searchOpen ? 'exercise-search-layer' : undefined}
          // The layer is a dialog while it is open; closed, this is a plain wrapper. The ELEMENT
          // never changes, only its attributes, so React keeps the same <input> below and the focus
          // the tap gave it.
          role={searchOpen ? 'dialog' : undefined}
          aria-modal={searchOpen || undefined}
          aria-label={searchOpen ? 'Exercise search' : undefined}
          // lib/visibleViewport.js leaves a field in here alone: the layer fills the window with the
          // field pinned at its top, so there is never anything to reveal, and a page scroll under
          // a fixed layer would only move the page the person comes back to.
          data-keyboard-layer={searchOpen ? '' : undefined}
        >
          <div className={searchOpen ? 'exercise-search-bar' : undefined}>
            {/* The app's most-used input, through the primitive (`.input` holds the iOS 16px floor
                that keeps Safari from zooming on focus; two e2e specs assert it). */}
            <Input
              ref={searchInputRef}
              data-tour-anchor={TOUR_ANCHORS.EXERCISE_SEARCH}
              value={exerciseSearch}
              onChange={(e) => setExerciseSearch(e.target.value)}
              onFocus={openSearch}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              placeholder="Search all exercises"
              enterKeyHint="search"
            />
            {searchOpen && (
              <Button variant="ghost" onClick={closeSearch} className="exercise-search-cancel">
                Cancel
              </Button>
            )}
          </div>

          {searchOpen && (
            <div ref={resultsRef} className="exercise-search-results">
              <div className="exercise-search-results-inner">
                {loading ? (
                  <Skeleton width="100%" height={46} radius={16} style={sectionSpacing} />
                ) : searching ? (
                  <div style={sectionSpacing}>
                    <SectionLabel style={sectionLabelSpacing}>Search results</SectionLabel>
                    <ExerciseSearchResults
                      results={searchResults}
                      term={exerciseSearch}
                      onSelect={selectFromSearch}
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
            </div>
          )}
        </div>
      </div>

      {/* The page below the field. Hidden from assistive tech (and from taps, via inert) while the
          layer covers it, so the layer's "+ Add your own exercise" is the only one there is. */}
      <div aria-hidden={searchOpen || undefined} inert={searchOpen || undefined}>
        {loading && (
          <>
            <Skeleton width={84} height={12} style={sectionLabelSpacing} />
            <div className="picker-chip-wrap" style={sectionSpacing}>
              {[110, 140, 96].map((w, i) => (
                <Skeleton key={i} width={w} height={46} radius={16} />
              ))}
            </div>
          </>
        )}

        {/* Default view: Favorites + Previously Logged. Searching never replaces it: results are
            in the layer, so this is what is here when Cancel closes it. */}
        {!loading &&
          (!hasList ? (
            // The first screen a brand-new person ever sees. No action button here on purpose -- the
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
          ))}

        {/* The Button primitive's secondary, like the top-of-tab actions on History and Routines. */}
        {!loading && (
          <Button onClick={() => onAddExercise(exerciseSearch)} data-tour-anchor={TOUR_ANCHORS.ADD_EXERCISE} fullWidth>
            + Add your own exercise
          </Button>
        )}
      </div>

      {preview && <ExercisePreviewSheet exerciseId={preview.id} exerciseName={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}

// Evidence for the simulator flow (09-search-focus-holds) and Safari's Web Inspector, because the
// one thing no browser here can show is what the App Store app's keyboard does to the layer
// (2026-11-26: on TestFlight the results did not scroll). Two kinds of `[search]` line:
//   geometry -- on every window / visual-viewport resize: the window, the visible part, the layer,
//               and the results' scrollTop / scrollHeight / clientHeight (no overflow = nothing to
//               scroll);
//   touch    -- per finger: where it landed, how many touchmoves arrived and how many were
//               cancelled, and the results' scrollTop before and after.
// Logging only; nothing here changes behaviour.
function logSearchEvidence(layer, results) {
  const vv = window.visualViewport;
  const round = (n) => Math.round(n ?? -1);
  let frame = 0;
  const geometry = (why) => {
    frame = 0;
    console.info(
      `[search] geometry (${why}): window ${window.innerHeight}, visible ${round(vv?.height)}+${round(vv?.offsetTop)}, layer ${round(layer.getBoundingClientRect().height)}, results ${round(results.scrollTop)}/${results.scrollHeight}/${results.clientHeight}`,
    );
  };
  const onResize = (event) => {
    if (!frame) frame = requestAnimationFrame(() => geometry(event.type === 'resize' && event.target === vv ? 'visual viewport' : 'window'));
  };
  let touch = null;
  const onTouchStart = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    touch = {
      on: target ? `${target.tagName.toLowerCase()}${results.contains(target) ? ' in results' : ''}` : '?',
      scrollTop: results.scrollTop,
      moves: 0,
      cancelled: 0,
    };
  };
  // On window, after the scroll lock's document listener, so defaultPrevented is its verdict.
  const onTouchMove = (event) => {
    if (!touch) return;
    touch.moves += 1;
    if (event.defaultPrevented) touch.cancelled += 1;
  };
  const onTouchEnd = () => {
    if (!touch) return;
    const t = touch;
    touch = null;
    // A frame later, so a fling that has already started shows in scrollTop.
    requestAnimationFrame(() =>
      console.info(
        `[search] touch on ${t.on}: ${t.moves} moves, ${t.cancelled} cancelled, results scrollTop ${round(t.scrollTop)} -> ${round(results.scrollTop)} of ${results.scrollHeight - results.clientHeight}`,
      ),
    );
  };
  window.addEventListener('resize', onResize);
  vv?.addEventListener('resize', onResize);
  layer.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  const first = requestAnimationFrame(() => geometry('open'));
  return () => {
    cancelAnimationFrame(first);
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('resize', onResize);
    vv?.removeEventListener('resize', onResize);
    layer.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  };
}

// One bounded, alphabetical section of chips. The clip is CSS (.picker-chip-wrap--clipped), so
// the first paint is already the right height at any viewport width; useChipRowOverflow only
// reports whether anything is actually cut off and where the cut falls.
function ChipGroup({ group, expanded, onToggle, onSelectExercise }) {
  const wrapRef = useRef(null);
  const { overflowing, firstHiddenIndex } = useChipRowOverflow(wrapRef, !expanded, group.items.length);

  return (
    <div style={sectionSpacing}>
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

// The screen's two vertical rhythms, shared by every block on it: a heading sits --space-2 above
// what it heads, and one block sits --space-5 above the next. "Or pick an exercise" was the one
// heading without the first, so it sat flush on the search field while "Start a routine" and
// "Favorites" each had a gap -- and the blocks themselves were 22, 16 and 20px apart. See
// design-system.md's "Vertical rhythm".
const sectionLabelSpacing = { marginBottom: 'var(--space-2)' };
const sectionSpacing = { marginBottom: 'var(--space-5)' };

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
