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
import { useSessionEntries } from '../../hooks/useSessionEntries';
import { endWorkout } from '../../api/sessions';
import { queryClient } from '../../lib/queryClient';
import { tryForceUpdate } from '../../lib/swUpdate';

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
vi.mock('../../hooks/useSessionEntries', () => ({ useSessionEntries: vi.fn() }));
vi.mock('../../api/sessions', () => ({ endWorkout: vi.fn().mockResolvedValue(), editSession: vi.fn() }));
vi.mock('../../lib/swUpdate', () => ({ tryForceUpdate: vi.fn() }));
vi.mock('./ExercisePicker', () => ({ default: () => <div>exercise-picker</div> }));
vi.mock('./ExerciseDetail', () => ({ default: () => <div>exercise-detail</div> }));
// Renders the entries LogTab hands it (rather than a static placeholder) so a test can verify
// LogTab's own wiring -- the merge/offline logic itself is useSessionEntries' own test's job.
vi.mock('./SessionSummary', () => ({
  default: ({ entries }) => (
    <div>
      session-summary
      {entries.map((entry) => (
        <div key={entry.exerciseId}>{entry.exerciseName}: {entry.sets.length} set(s)</div>
      ))}
    </div>
  ),
}));

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
    useRoutines.mockReturnValue({ routines: [routine], loading: false, isFetching: false, updatedAt: Date.now() });
    useLiveSession.mockReturnValue({ session: null, refetch: vi.fn() });
    useHistory.mockReturnValue({ history: [], loading: false, refetch: vi.fn() });
    useSessionEntries.mockReturnValue([]);
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

  it('scrolls the current routine pill into view as the routine advances', () => {
    // jsdom has no real layout/scrolling, so this only verifies the effect calls
    // scrollIntoView on the newly-current pill -- not actual on-screen movement.
    Element.prototype.scrollIntoView = vi.fn();
    useAppState.mockReturnValue(baseAppState({ selectedExerciseId: 1, routineIndex: 0 }));
    const { rerender } = render(<MemoryRouter><LogTab /></MemoryRouter>);

    useAppState.mockReturnValue(baseAppState({ selectedExerciseId: 2, routineIndex: 1 }));
    rerender(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', inline: 'center', block: 'nearest' });
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

  it('ending the workout is a forced-reload trigger point', async () => {
    const appState = baseAppState({ selectedExerciseId: 1, routineIndex: 0 });
    useAppState.mockReturnValue(appState);
    useLiveSession.mockReturnValue({ session: { id: 55, startedAt: '2026-07-15T12:00:00Z' }, refetch: vi.fn() });
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
    const confirmButton = screen.getAllByRole('button', { name: 'End workout' }).at(-1);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(endWorkout).toHaveBeenCalledWith(7));
    expect(tryForceUpdate).toHaveBeenCalledWith(queryClient, 7);
  });

  // Regression test: `routinesLoading`/`isFetching` both read as "settled" (false) in states where
  // `routines` is NOT yet trustworthy -- e.g. right after a reload, before `activePersonId` itself
  // has resolved, the query is `enabled: false` (neither loading nor fetching), so `routines`
  // defaults to `[]`, indistinguishable from "genuinely empty and settled". `updatedAt`
  // (dataUpdatedAt) sidesteps this: it's falsy until a real fetch has ever completed, regardless of
  // why. Reproduced live against the lower environment (higher latency widened the window enough to
  // hit consistently; local dev's near-zero latency never saw it).
  it('does not end the routine before the routines query has ever completed a real fetch (updatedAt falsy), even if routines reads empty', () => {
    const appState = baseAppState({ selectedExerciseId: 1, routineIndex: 0 });
    useAppState.mockReturnValue(appState);
    useRoutines.mockReturnValue({ routines: [], loading: false, isFetching: false, updatedAt: 0 });

    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(appState.endRoutine).not.toHaveBeenCalled();
  });

  // A second, narrower race: the query cache persister is throttled (at most once/second, see
  // queryClient.js's queryPersister), so a reload shortly after creating/advancing a routine can
  // restore a STALE (but present, non-zero updatedAt) snapshot that predates it, while the real list
  // is still being fetched in the background (isFetching: true). updatedAt alone doesn't catch this
  // -- it must also wait for isFetching to clear before trusting a stale-but-present list.
  it('does not end the routine while the routines query is still fetching in the background, even with a non-zero (but stale) updatedAt', () => {
    const appState = baseAppState({ selectedExerciseId: 1, routineIndex: 0 });
    useAppState.mockReturnValue(appState);
    useRoutines.mockReturnValue({ routines: [], loading: false, isFetching: true, updatedAt: Date.now() - 5000 });

    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(appState.endRoutine).not.toHaveBeenCalled();
  });

  // Once a real fetch has completed (updatedAt truthy) and nothing is still in flight, and the
  // routine genuinely isn't in the (now real) list, the existing cleanup behavior must still fire --
  // this isn't gated on either signal staying "not ready" forever, only on the transient windows
  // above.
  it('still ends the routine once a real fetch has completed and it is genuinely gone', () => {
    const appState = baseAppState({ selectedExerciseId: 1, routineIndex: 0 });
    useAppState.mockReturnValue(appState);
    useRoutines.mockReturnValue({ routines: [], loading: false, isFetching: false, updatedAt: Date.now() });

    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(appState.endRoutine).toHaveBeenCalled();
  });

  // While offline with no live session yet, ExerciseDetail's onMutate optimistically seeds a
  // PROVISIONAL session -- { id: null, startedAt: <clientLoggedAt> } -- into the same
  // liveSession cache useLiveSession reads (see ExerciseDetail.jsx's onMutate). LogTab itself
  // needs no code change to handle this: it already gates on `liveSession` truthiness, not
  // `liveSession.id`. This is a regression test proving that stays true.
  it('shows the "Session in progress" banner and End workout button for a provisional (id: null) live session', () => {
    useAppState.mockReturnValue(baseAppState({ selectedExerciseId: 1, routineIndex: 0 }));
    useLiveSession.mockReturnValue({ session: { id: null, startedAt: '2026-07-22T09:00:00Z' }, refetch: vi.fn() });
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(screen.getByText(/Session in progress/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End workout' })).toBeInTheDocument();
  });

  // Previously SessionSummary was gated on a truthy SERVER session id, so it stayed entirely
  // absent for a provisional (offline, id: null) live session -- even once useSessionEntries
  // (mocked here; its own merge logic is covered by useSessionEntries.test.jsx) has entries to
  // show. LogTab must render it for any active session, provisional included.
  it('shows SessionSummary (with entries) for a provisional (id: null) live session, not just the banner', () => {
    useAppState.mockReturnValue(baseAppState({ selectedExerciseId: null }));
    useLiveSession.mockReturnValue({ session: { id: null, startedAt: '2026-07-22T09:00:00Z' }, refetch: vi.fn() });
    useSessionEntries.mockReturnValue([
      { exerciseId: 1, exerciseName: 'Bench Press', sets: [{ id: 'optimistic-a', weight: 135, reps: 5, unit: 'lb', optimistic: true }] },
    ]);
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(screen.getByText('session-summary')).toBeInTheDocument();
    expect(screen.getByText('Bench Press: 1 set(s)')).toBeInTheDocument();
  });
});

describe('LogTab "create a routine" banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppState.mockReturnValue(baseAppState({ selectedExerciseId: null, activeRoutineId: null }));
    useUI.mockReturnValue({ showToast: vi.fn() });
    useExercises.mockReturnValue({ exercises: [], loading: false });
    usePersonExercises.mockReturnValue({ exercises: [], loading: false, refetch: vi.fn().mockResolvedValue() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: vi.fn().mockResolvedValue() });
    useLiveSession.mockReturnValue({ session: null, refetch: vi.fn() });
    useHistory.mockReturnValue({ history: [], loading: false, refetch: vi.fn() });
    useSessionEntries.mockReturnValue([]);
  });

  const bannerText = 'For faster exercise logging,';

  it('shows the banner when the person has no routines', () => {
    useRoutines.mockReturnValue({ routines: [], loading: false });
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(screen.getByText(bannerText, { exact: false })).toBeInTheDocument();
  });

  it('hides the banner while routines are still loading', () => {
    useRoutines.mockReturnValue({ routines: [], loading: true });
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(screen.queryByText(bannerText, { exact: false })).not.toBeInTheDocument();
  });

  it('hides the banner once the person has at least one routine', () => {
    useRoutines.mockReturnValue({ routines: [routine], loading: false });
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(screen.queryByText(bannerText, { exact: false })).not.toBeInTheDocument();
  });

  it('dismissing the banner hides it and keeps it hidden across remounts for that person', () => {
    useRoutines.mockReturnValue({ routines: [], loading: false });
    const { unmount } = render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(screen.getByText(bannerText, { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(bannerText, { exact: false })).not.toBeInTheDocument();

    unmount();
    render(<MemoryRouter><LogTab /></MemoryRouter>);
    expect(screen.queryByText(bannerText, { exact: false })).not.toBeInTheDocument();
  });
});
