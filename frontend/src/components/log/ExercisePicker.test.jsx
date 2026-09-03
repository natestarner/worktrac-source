import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExercisePicker from './ExercisePicker';
import { useAppState } from '../../context/AppStateContext';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

// ExercisePicker reads the person's exercise-search draft from AppStateContext; mock it so
// these tests control the "searching vs default view" branch directly.
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));

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

describe('ExercisePicker empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ exerciseSearch: '', setExerciseSearch: vi.fn() });
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
  });

  it('anchors the search input and the "Add your own exercise" button', () => {
    const { container } = renderPicker();
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.EXERCISE_SEARCH}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.ADD_EXERCISE}"]`)).not.toBeNull();
  });
});

// The search field moved from a hand-rolled <input> to the Input primitive. Two things about that
// swap fail SILENTLY, so both are pinned here rather than trusted.
describe('ExercisePicker search field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ exerciseSearch: '', setExerciseSearch: vi.fn() });
  });

  // `Input` is a plain function component, not forwardRef -- so the ref only reaches the element
  // because React 19 passes `ref` as an ordinary prop into `...rest`. If that ever stops being
  // true, `searchInputRef.current` is null and the focus handler's `?.scrollIntoView` guard
  // swallows it: the keyboard covers the results on a phone and nothing anywhere reports why.
  it('forwards the ref to the real input, so the focus-scroll can still fire', () => {
    renderPicker();
    const input = screen.getByPlaceholderText('Search all exercises');

    const scrollIntoView = vi.fn();
    input.scrollIntoView = scrollIntoView;
    fireEvent.focus(input);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  // 16px is the threshold below which iOS Safari zooms the viewport on focus. It used to be a
  // literal with a comment beside it; it is now `.input`'s --text-md, which two e2e specs assert.
  it('renders through the .input class rather than a hand-rolled copy of it', () => {
    renderPicker();
    expect(screen.getByPlaceholderText('Search all exercises')).toHaveClass('input');
  });
});
