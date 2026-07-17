import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LogTab from './LogTab';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';
import { useTags } from '../../hooks/useTags';
import { useRoutines } from '../../hooks/useRoutines';
import { useLiveSession } from '../../hooks/useLiveSession';
import { useHistory } from '../../hooks/useHistory';
import { endWorkout } from '../../api/sessions';

// LogTab's own job here is placement: the Next Exercise / Finish Routine button lives in
// the routine progress card (rendered by LogTab itself, near the top of the page) rather
// than at the bottom of ExerciseDetail, so it can't get covered by the fixed-position
// RestTimerBar. ExercisePicker/ExerciseDetail/SessionSummary are mocked out since their
// own behavior is covered elsewhere -- this test only exercises LogTab's routine card.
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useExercises', () => ({ useExercises: vi.fn() }));
vi.mock('../../hooks/usePersonExercises', () => ({ usePersonExercises: vi.fn() }));
vi.mock('../../hooks/useTags', () => ({ useTags: vi.fn() }));
vi.mock('../../api/exercises', () => ({ favoriteExercise: vi.fn(), unfavoriteExercise: vi.fn() }));
vi.mock('../../hooks/useRoutines', () => ({ useRoutines: vi.fn() }));
vi.mock('../../hooks/useLiveSession', () => ({ useLiveSession: vi.fn() }));
vi.mock('../../hooks/useHistory', () => ({ useHistory: vi.fn() }));
vi.mock('../../api/sessions', () => ({ endWorkout: vi.fn().mockResolvedValue(), editSession: vi.fn() }));
vi.mock('./ExercisePicker', () => ({ default: () => <div>exercise-picker</div> }));
vi.mock('./ExerciseDetail', () => ({ default: () => <div>exercise-detail</div> }));
vi.mock('./SessionSummary', () => ({ default: () => <div>session-summary</div> }));

const routine = {
  id: 9,
  name: 'Push Day',
  exercises: [
    { exerciseId: 1, exerciseName: 'Bench Press' },
    { exerciseId: 2, exerciseName: 'Overhead Press' },
  ],
};

function baseAppState(overrides = {}) {
  return {
    activePersonId: 7,
    selectedExerciseId: null,
    activeRoutineId: routine.id,
    routineIndex: 0,
    editingSession: null,
    selectExercise: vi.fn(),
    backToPicker: vi.fn(),
    startRoutine: vi.fn(),
    jumpToRoutineIndex: vi.fn(),
    nextExerciseInRoutine: vi.fn(),
    endRoutine: vi.fn(),
    doneEditingSession: vi.fn(),
    updateEditingSession: vi.fn(),
    ...overrides,
  };
}

describe('LogTab routine nav button placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUI.mockReturnValue({ showToast: vi.fn() });
    useExercises.mockReturnValue({ exercises: [{ id: 1, name: 'Bench Press' }, { id: 2, name: 'Overhead Press' }], loading: false });
    usePersonExercises.mockReturnValue({ exercises: [], loading: false, refetch: vi.fn().mockResolvedValue() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: vi.fn().mockResolvedValue() });
    useRoutines.mockReturnValue({ routines: [routine] });
    useLiveSession.mockReturnValue({ session: null, refetch: vi.fn() });
    useHistory.mockReturnValue({ history: [], loading: false, refetch: vi.fn() });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not show the routine nav button on the exercise picker, before an exercise is selected', () => {
    useAppState.mockReturnValue(baseAppState({ selectedExerciseId: null }));
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(screen.getByText('exercise-picker')).toBeInTheDocument();
    expect(screen.queryByText('Next exercise')).not.toBeInTheDocument();
    expect(screen.queryByText('Finish routine')).not.toBeInTheDocument();
  });

  it('shows "Next exercise" in the routine card while mid-routine, and advances on click', () => {
    useAppState.mockReturnValue(baseAppState({ selectedExerciseId: 1, routineIndex: 0 }));
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    const button = screen.getByText('Next exercise');
    expect(button).toBeInTheDocument();
    expect(screen.getByText('Push Day')).toBeInTheDocument();

    fireEvent.click(button);
    expect(useAppState.mock.results[0].value.nextExerciseInRoutine).toHaveBeenCalledWith([1, 2]);
  });

  it('shows "Finish routine" in the routine card on the last exercise', () => {
    useAppState.mockReturnValue(baseAppState({ selectedExerciseId: 2, routineIndex: 1 }));
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(screen.getByText('Finish routine')).toBeInTheDocument();
    expect(screen.queryByText('Next exercise')).not.toBeInTheDocument();
  });

  it('ending the workout mid-routine also ends the routine', async () => {
    const appState = baseAppState({ selectedExerciseId: 1, routineIndex: 0 });
    useAppState.mockReturnValue(appState);
    useLiveSession.mockReturnValue({ session: { id: 55, startedAt: '2026-07-15T12:00:00Z' }, refetch: vi.fn() });
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    // The live-session bar and the confirm modal's own button share the label "End
    // workout" once the modal is open -- the confirm modal's is the one added last.
    fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
    const confirmButton = screen.getAllByRole('button', { name: 'End workout' }).at(-1);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(endWorkout).toHaveBeenCalledWith(7));
    expect(appState.endRoutine).toHaveBeenCalled();
  });
});
