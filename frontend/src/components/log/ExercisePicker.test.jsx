import { render, screen } from '@testing-library/react';
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
