import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExercisePicker from './ExercisePicker';
import { useChipRowOverflow } from '../../hooks/useChipRowOverflow';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

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
      routines={[]}
      loading={false}
      onSelectExercise={vi.fn()}
      onAddExercise={vi.fn()}
      onStartRoutine={vi.fn()}
      onOpenSearch={vi.fn()}
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
    useChipRowOverflow.mockReturnValue(NOTHING_HIDDEN);
  });

  it('anchors the search input and the "Add your own exercise" button', () => {
    const { container } = renderPicker();
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.EXERCISE_SEARCH}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.ADD_EXERCISE}"]`)).not.toBeNull();
  });
});

// On the Log page the search "field" is a BUTTON drawn as the field (SearchTrigger): a tap opens
// the search screen (LogTab's openSearch), whose own field is focused in the same click. A real
// <input> here would take the focus mid-page and then have to move, which is what broke every
// earlier design (docs/architecture/exercise-search-history.md).
describe('ExercisePicker search trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChipRowOverflow.mockReturnValue(NOTHING_HIDDEN);
  });

  function trigger() {
    return screen.getByRole('button', { name: 'Search all exercises' });
  }

  it('is a button, not a field: nothing on the Log page can take the keyboard', () => {
    const { container } = renderPicker();
    expect(trigger().tagName).toBe('BUTTON');
    expect(container.querySelector('input')).toBeNull();
  });

  // `.input` carries the 16px floor and the field's look; the trigger must read as the field.
  it('is drawn with the .input class', () => {
    renderPicker();
    expect(trigger()).toHaveClass('input');
  });

  // What is typed lives and dies with the search screen, so the trigger always reads as empty.
  it('shows the placeholder', () => {
    renderPicker();
    expect(trigger()).toHaveTextContent('Search all exercises');
  });

  it('a tap opens the search (a click, the tap’s last event, so no ghost click can follow)', () => {
    const onOpenSearch = vi.fn();
    renderPicker({ onOpenSearch });
    fireEvent.click(trigger());
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('stays below "Or pick an exercise": the page order is unchanged', () => {
    renderPicker({ routines: routines(2) });
    const heading = screen.getByText('Or pick an exercise');
    expect(heading.compareDocumentPosition(trigger()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// The routine quick-start block sits ABOVE the search field, so its length is what decides
// whether the rest of the picker starts below the fold. Unlike the chip groups this bound is a
// plain slice, so it is fully testable here.
describe('ExercisePicker routine quick-start bound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
