import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExercisePicker from './ExercisePicker';
import { useAppState } from '../../context/AppStateContext';
import { useChipRowOverflow } from '../../hooks/useChipRowOverflow';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

// ExercisePicker reads the person's exercise-search draft from AppStateContext; mock it so
// these tests control the "searching vs default view" branch directly.
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));

// The chip groups are bounded by measuring a clipped container against its own cap, and jsdom
// lays nothing out -- scrollHeight is 0 and ResizeObserver doesn't exist, so the real hook can
// only ever answer "nothing is hidden" here. Mocking it is what makes the COMPONENT's half
// (which control appears, what it says, what happens to the chips past the cut) testable at
// this layer. The hook's own measurement is proven where layout is real:
// e2e/tests/picker-bounds.spec.ts.
vi.mock('../../hooks/useChipRowOverflow', () => ({ useChipRowOverflow: vi.fn() }));

const NOTHING_HIDDEN = { overflowing: false, firstHiddenIndex: -1 };

function renderPicker(props = {}) {
  return render(
    <ExercisePicker
      personExercises={[]}
      catalog={[]}
      routines={[]}
      loading={false}
      onSelectExercise={vi.fn()}
      onAddExercise={vi.fn()}
      onStartRoutine={vi.fn()}
      hasActiveRoutine={false}
      {...props}
    />
  );
}

function exercises(count, { favorite = false, prefix = 'Exercise' } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1 + (favorite ? 0 : 1000),
    name: `${prefix} ${i + 1}`,
    isFavorite: favorite,
  }));
}

function routines(count) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Routine ${i + 1}`, exercises: [] }));
}

describe('ExercisePicker empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ exerciseSearch: '', setExerciseSearch: vi.fn() });
    useChipRowOverflow.mockReturnValue(NOTHING_HIDDEN);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the favorites-focused empty copy when the person has no exercises', () => {
    renderPicker({ personExercises: [] });

    expect(
      screen.getByText(
        "Let's find your first exercise"
      )
    ).toBeInTheDocument();
  });

  it('hides the empty copy once the person has at least one exercise', () => {
    renderPicker({ personExercises: [{ id: 1, name: 'Bench Press', isFavorite: true }] });

    expect(screen.queryByText(/Let's find your first exercise/)).not.toBeInTheDocument();
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
  });
});

// Cheap and high-value: stops a refactor silently deleting an attribute nothing else in this file
// references.
describe('ExercisePicker tour anchors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ exerciseSearch: '', setExerciseSearch: vi.fn() });
    useChipRowOverflow.mockReturnValue(NOTHING_HIDDEN);
  });

  it('anchors the search input and the "Add your own exercise" button', () => {
    const { container } = renderPicker();
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.EXERCISE_SEARCH}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.ADD_EXERCISE}"]`)).not.toBeNull();
  });
});

// The search field goes through the Input primitive. 16px is the threshold below which iOS Safari
// zooms the viewport on focus; it is `.input`'s --text-md, which two e2e specs assert.
describe('ExercisePicker search field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ exerciseSearch: '', setExerciseSearch: vi.fn() });
    useChipRowOverflow.mockReturnValue(NOTHING_HIDDEN);
  });

  it('renders through the .input class rather than a hand-rolled copy of it', () => {
    renderPicker();
    expect(screen.getByPlaceholderText('Search all exercises')).toHaveClass('input');
  });
});

// #626: tapping the search used to scroll the PAGE to put the field at the top, and in the App
// Store app the keyboard's resize defeated that about half the time. It now opens a full-screen
// layer instead: the same <input>, lifted into a fixed layer with results under it and a Cancel.
// The page itself is never scrolled.
describe('ExercisePicker full-screen search', () => {
  const catalog = [
    { id: 11, name: 'Back Squat' },
    { id: 12, name: 'Front Squat' },
    { id: 13, name: 'Bench Press' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useChipRowOverflow.mockReturnValue(NOTHING_HIDDEN);
  });

  function tapSearch() {
    act(() => screen.getByPlaceholderText('Search all exercises').focus());
  }

  function withSearch(term, setExerciseSearch = vi.fn()) {
    useAppState.mockReturnValue({ exerciseSearch: term, setExerciseSearch });
    return setExerciseSearch;
  }

  it('opens the layer on the first tap, around the SAME input, and scrolls nothing', () => {
    withSearch('');
    renderPicker({ catalog, routines: routines(1) });
    const input = screen.getByPlaceholderText('Search all exercises');
    const scrollIntoView = vi.fn();
    input.scrollIntoView = scrollIntoView;
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => input.focus());

    const layer = screen.getByRole('dialog', { name: 'Exercise search' });
    // Same node: React kept the element, so the focus (and on a phone, the keyboard) stayed.
    expect(layer).toContainElement(input);
    expect(document.activeElement).toBe(input);
    expect(layer).toHaveClass('exercise-search-layer');
    expect(layer).toHaveAttribute('data-keyboard-layer');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('shows the results inside the layer and hides the page behind it', () => {
    withSearch('squ');
    renderPicker({ catalog, routines: routines(2) });
    tapSearch();
    const layer = screen.getByRole('dialog', { name: 'Exercise search' });
    expect(layer).toHaveTextContent('Search results');
    expect(screen.getByRole('button', { name: 'Back Squat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Front Squat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bench Press' })).toBeNull();

    // The page is still there, unchanged, so Cancel returns to exactly it -- but nothing in it can
    // be reached while the layer covers it.
    expect(screen.getByText('Start a routine')).toBeInTheDocument();
    expect(screen.getByText('Or pick an exercise')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Routine 1/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: '+ Add your own exercise' })).toHaveLength(1);
    expect(layer).toContainElement(screen.getByRole('button', { name: '+ Add your own exercise' }));
  });

  // A search restored by a person switch back or a reload sits in the field; it does not throw a
  // full-screen layer over the page by itself. One tap brings its results back.
  it('never opens by itself: a restored search waits in the field for a tap', () => {
    withSearch('bench');
    renderPicker({ catalog });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByPlaceholderText('Search all exercises')).toHaveValue('bench');
    tapSearch();
    expect(screen.getByRole('button', { name: 'Bench Press' })).toBeInTheDocument();
  });

  // Cancel keeps the text: it is this person's draft, which must survive a person switch, and the
  // person bar is under the layer.
  it('Cancel closes the layer, keeps the typed search and takes focus off the field', () => {
    const setExerciseSearch = withSearch('squ');
    renderPicker({ catalog });
    const input = screen.getByPlaceholderText('Search all exercises');
    act(() => input.focus());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setExerciseSearch).not.toHaveBeenCalled();
    expect(input).toHaveValue('squ');
    // Through the ref: proves it still reaches the real <input> (React 19 passes `ref` as a prop).
    expect(document.activeElement).not.toBe(input);
  });

  it("Escape is the keyboard's Cancel", () => {
    const setExerciseSearch = withSearch('');
    renderPicker({ catalog });
    const input = screen.getByPlaceholderText('Search all exercises');
    act(() => input.focus());
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setExerciseSearch).not.toHaveBeenCalled();
  });

  it('choosing a result selects it and closes the layer', () => {
    withSearch('squ');
    const onSelectExercise = vi.fn();
    renderPicker({ catalog, onSelectExercise });
    tapSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Front Squat' }));
    expect(onSelectExercise).toHaveBeenCalledWith(12);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"+ Add your own exercise" in the layer starts from what was typed', () => {
    withSearch('zercher');
    const onAddExercise = vi.fn();
    renderPicker({ catalog, onAddExercise });
    tapSearch();
    expect(screen.getByText(/No exercises match "zercher"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Add your own exercise' }));
    expect(onAddExercise).toHaveBeenCalledWith('zercher');
  });

  it('typing changes nothing on the page: the default view stays under the layer', () => {
    const setExerciseSearch = withSearch('');
    const { container, rerender } = renderPicker({ catalog, personExercises: exercises(3, { favorite: true }) });
    const before = container.querySelector('.picker-chip-wrap');
    act(() => screen.getByPlaceholderText('Search all exercises').focus());
    withSearch('s', setExerciseSearch);
    rerender(
      <ExercisePicker
        personExercises={exercises(3, { favorite: true })}
        catalog={catalog}
        routines={[]}
        loading={false}
        onSelectExercise={vi.fn()}
        onAddExercise={vi.fn()}
        onStartRoutine={vi.fn()}
        hasActiveRoutine={false}
      />
    );
    expect(container.querySelector('.picker-chip-wrap')).toBe(before);
  });
});

// The routine quick-start block sits ABOVE the search field, so its length is what decides
// whether the rest of the picker starts below the fold. Unlike the chip groups this bound is a
// plain slice, so it is fully testable here.
describe('ExercisePicker routine quick-start bound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ exerciseSearch: '', setExerciseSearch: vi.fn() });
    useChipRowOverflow.mockReturnValue(NOTHING_HIDDEN);
  });

  it('shows every routine, and no disclosure, at four or fewer', () => {
    renderPicker({ routines: routines(4) });

    expect(screen.getByText('Routine 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('shows only the first four beyond that, and names the count in the control', () => {
    renderPicker({ routines: routines(14) });

    expect(screen.getByText('Routine 4')).toBeInTheDocument();
    expect(screen.queryByText('Routine 5')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all 14 routines' })).toBeInTheDocument();
  });

  it('expands to the full list and collapses again', () => {
    renderPicker({ routines: routines(14) });

    fireEvent.click(screen.getByRole('button', { name: 'Show all 14 routines' }));
    expect(screen.getByText('Routine 14')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse routines' }));
    expect(screen.queryByText('Routine 14')).not.toBeInTheDocument();
    expect(screen.getByText('Routine 4')).toBeInTheDocument();
  });

  it('puts the routine disclosure below the routine list', () => {
    const { container } = renderPicker({ routines: routines(14) });

    const list = container.querySelector('[style*="column"]');
    const disclosure = screen.getByRole('button', { name: 'Show all 14 routines' });

    // eslint-disable-next-line no-bitwise
    expect(list.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Starting a routine is the point of the block; collapsing must not have cost the handler.
  it('still starts a routine revealed by expanding', () => {
    const onStartRoutine = vi.fn();
    renderPicker({ routines: routines(14), onStartRoutine });

    fireEvent.click(screen.getByRole('button', { name: 'Show all 14 routines' }));
    fireEvent.click(screen.getByText('Routine 9'));

    expect(onStartRoutine).toHaveBeenCalledWith(expect.objectContaining({ name: 'Routine 9' }));
  });
});

describe('ExercisePicker exercise group bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ exerciseSearch: '', setExerciseSearch: vi.fn() });
  });

  it('offers no disclosure while everything fits', () => {
    useChipRowOverflow.mockReturnValue(NOTHING_HIDDEN);
    renderPicker({ personExercises: exercises(3, { favorite: true }) });

    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('offers a disclosure naming the group once chips are cut off', () => {
    useChipRowOverflow.mockReturnValue({ overflowing: true, firstHiddenIndex: 2 });
    renderPicker({ personExercises: exercises(5, { favorite: true }) });

    expect(screen.getByRole('button', { name: 'Show all 5 favorites' })).toBeInTheDocument();
  });

  // The label rule from frontend-core.md, pinned rather than remembered: Playwright matches an
  // accessible name by SUBSTRING, so two groups both saying "Show all" (or both "Hide") would be
  // mutually ambiguous on the app's most-used screen.
  it('gives each group a disclosure label that does not contain the other', () => {
    useChipRowOverflow.mockReturnValue({ overflowing: true, firstHiddenIndex: 1 });
    renderPicker({
      personExercises: [...exercises(3, { favorite: true, prefix: 'Fav' }), ...exercises(4, { prefix: 'Other' })],
    });

    const labels = screen
      .getAllByRole('button', { name: /Show all/ })
      .map((button) => button.textContent);

    expect(labels).toEqual(['Show all 3 favorites', 'Show all 4 exercises']);
    expect(labels[0].includes(labels[1])).toBe(false);
    expect(labels[1].includes(labels[0])).toBe(false);
  });

  // A chip past the cut is clipped by CSS but still in the DOM. Without inert it stays focusable,
  // stays in the accessibility tree, and still passes Playwright's toBeVisible() -- so "hidden"
  // would be true only to a sighted mouse user.
  it('marks the chips past the cut inert, and only those', () => {
    useChipRowOverflow.mockReturnValue({ overflowing: true, firstHiddenIndex: 2 });
    renderPicker({ personExercises: exercises(4, { favorite: true }) });

    expect(screen.getByLabelText('Exercise 1')).not.toHaveAttribute('inert');
    expect(screen.getByLabelText('Exercise 2')).not.toHaveAttribute('inert');
    expect(screen.getByLabelText('Exercise 3')).toHaveAttribute('inert');
    expect(screen.getByLabelText('Exercise 4')).toHaveAttribute('inert');
  });

  it('drops the clip and the inert marks when expanded, and restores them on collapse', () => {
    useChipRowOverflow.mockReturnValue({ overflowing: true, firstHiddenIndex: 2 });
    const { container } = renderPicker({ personExercises: exercises(4, { favorite: true }) });

    expect(container.querySelector('.picker-chip-wrap--clipped')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all 4 favorites' }));
    expect(container.querySelector('.picker-chip-wrap--clipped')).toBeNull();
    expect(screen.getByLabelText('Exercise 4')).not.toHaveAttribute('inert');

    // The control has to survive expansion -- collapsing is the only way back, and the hook
    // reports `overflowing: false` while expanded precisely because nothing is clipped then.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse favorites' }));
    expect(container.querySelector('.picker-chip-wrap--clipped')).not.toBeNull();
    expect(screen.getByLabelText('Exercise 4')).toHaveAttribute('inert');
  });

  // The affordance itself, and the reason it moved: beside the section heading it read as
  // decoration on a label, and it sat nowhere near the place the list actually stops.
  it('puts the disclosure below its list, not up beside the section heading', () => {
    useChipRowOverflow.mockReturnValue({ overflowing: true, firstHiddenIndex: 2 });
    const { container } = renderPicker({ personExercises: exercises(5, { favorite: true }) });

    const wrap = container.querySelector('.picker-chip-wrap');
    const disclosure = screen.getByRole('button', { name: 'Show all 5 favorites' });
    const heading = screen.getByText('Favorites');

    // eslint-disable-next-line no-bitwise
    expect(wrap.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(heading.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The clip lands exactly on a row boundary, so a truncated list looks deliberately complete --
  // no half-row peeks out to suggest otherwise. The chevron is what carries "there is more", and
  // flipping it is what makes collapsing read as the inverse rather than a second control.
  it('points the chevron down while collapsed and up while expanded', () => {
    useChipRowOverflow.mockReturnValue({ overflowing: true, firstHiddenIndex: 2 });
    renderPicker({ personExercises: exercises(5, { favorite: true }) });

    const collapsed = screen.getByRole('button', { name: 'Show all 5 favorites' });
    expect(collapsed.querySelector('svg')).toHaveStyle({ transform: 'none' });

    fireEvent.click(collapsed);

    const expanded = screen.getByRole('button', { name: 'Collapse favorites' });
    expect(expanded.querySelector('svg')).toHaveStyle({ transform: 'rotate(180deg)' });
    expect(expanded).toHaveAttribute('aria-expanded', 'true');
  });

  // The chip truncates with an ellipsis at narrow widths, so the visible text is not a reliable
  // accessible name -- ~40 selectors across both test layers look exercises up by name.
  it('keeps the full exercise name as the chip accessible name', () => {
    useChipRowOverflow.mockReturnValue(NOTHING_HIDDEN);
    const onSelectExercise = vi.fn();
    renderPicker({
      personExercises: [{ id: 7, name: 'Single-Arm Dumbbell Preacher Curl', isFavorite: true }],
      onSelectExercise,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Single-Arm Dumbbell Preacher Curl' }));
    expect(onSelectExercise).toHaveBeenCalledWith(7);
  });
});
