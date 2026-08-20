import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LogTab from './LogTab';
import { renderWithQuery } from '../../test/queryWrapper';
import { setExerciseIdMapping, clearExerciseIdMap } from '../../lib/exerciseIdMap';
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
vi.mock('../../api/exercises', () => ({
  addExercise: vi.fn().mockResolvedValue({ id: 4242 }),
  favoriteExercise: vi.fn().mockResolvedValue({}),
  unfavoriteExercise: vi.fn(),
  updateExercise: vi.fn(),
  listExercises: vi.fn().mockResolvedValue([]),
  listPersonExercises: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../hooks/useRoutines', () => ({ useRoutines: vi.fn() }));
vi.mock('../../hooks/useLiveSession', () => ({ useLiveSession: vi.fn() }));
vi.mock('../../hooks/useHistory', () => ({ useHistory: vi.fn() }));
vi.mock('../../hooks/useSessionEntries', () => ({ useSessionEntries: vi.fn() }));
vi.mock('../../api/sessions', () => ({ endWorkout: vi.fn().mockResolvedValue(), editSession: vi.fn() }));
vi.mock('./ExercisePicker', () => ({
  default: ({ onAddExercise }) => (
    <div>
      exercise-picker
      <button onClick={() => onAddExercise('Zercher Squat')}>mock-add-own</button>
    </div>
  ),
}));
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
    setExerciseSearch: vi.fn(),
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

  // The nav button used to be gated on `selectedExercise` -- a condition inherited from when it
  // lived inside ExerciseDetail, which only renders WITH an exercise open. Backing out to the
  // picker mid-routine therefore hid the only way to advance the routine, leaving the card with
  // a position readout and no controls but the pills.
  it('shows the routine nav button on the exercise picker too, before an exercise is selected', () => {
    const appState = baseAppState({ selectedExerciseId: null, routineIndex: 0 });
    useAppState.mockReturnValue(appState);
    render(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(screen.getByText('exercise-picker')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next exercise' }));
    expect(appState.nextExerciseInRoutine).toHaveBeenCalledWith([1, 2]);
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

  // Ending a routine early. Before this button the only exit was "Finish routine", which shows
  // solely on the LAST step -- so bailing out at step 1 of 8 meant scrubbing the pill strip to
  // the end and tapping in, or stepping through every remaining exercise.
  describe('ending a routine early', () => {
    it('offers "End routine" on the exercise screen and clears the routine', () => {
      const appState = baseAppState({ selectedExerciseId: 1, routineIndex: 0 });
      useAppState.mockReturnValue(appState);
      const showToast = vi.fn();
      useUI.mockReturnValue({ showToast });
      render(<MemoryRouter><LogTab /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: 'End routine' }));

      expect(appState.endRoutine).toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('Routine ended.');
    });

    // The whole point of the placement: the routine card renders above BOTH the picker and the
    // exercise screen, so the exit is reachable from either without first opening an exercise.
    it('offers "End routine" on the picker too, with no exercise selected', () => {
      const appState = baseAppState({ selectedExerciseId: null, routineIndex: 0 });
      useAppState.mockReturnValue(appState);
      render(<MemoryRouter><LogTab /></MemoryRouter>);

      expect(screen.getByText('exercise-picker')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'End routine' }));

      expect(appState.endRoutine).toHaveBeenCalled();
    });

    // Reachable from the FIRST step, not just the last -- this is the gap the button exists to
    // close, so assert it at a position where "Finish routine" is nowhere on screen.
    it('is available mid-routine, where "Finish routine" is not', () => {
      useAppState.mockReturnValue(baseAppState({ selectedExerciseId: 1, routineIndex: 0 }));
      render(<MemoryRouter><LogTab /></MemoryRouter>);

      expect(screen.getByRole('button', { name: 'End routine' })).toBeInTheDocument();
      expect(screen.queryByText('Finish routine')).not.toBeInTheDocument();
    });

    // Ending the ROUTINE is not ending the WORKOUT: the session stays live (no endWorkout call,
    // no confirm modal), so the person can keep logging off-script. The reverse direction --
    // ending the workout also ends the routine -- is covered separately below.
    it('leaves the live workout session running', () => {
      useAppState.mockReturnValue(baseAppState({ selectedExerciseId: 1, routineIndex: 0 }));
      useLiveSession.mockReturnValue({ session: { id: 55, startedAt: '2026-07-15T12:00:00Z' }, refetch: vi.fn() });
      render(<MemoryRouter><LogTab /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: 'End routine' }));

      expect(endWorkout).not.toHaveBeenCalled();
      // That the session stays VISIBLE is SessionBar's assertion now -- LogTab no longer paints
      // any session chrome of its own, so the absence of an End workout control here is the
      // positive check that the banner really did move rather than being duplicated.
      expect(screen.queryByRole('button', { name: 'End workout' })).not.toBeInTheDocument();
    });

    // The routine card is what carries the button, so it must not linger once the routine is
    // over -- and there is no second exit to leave behind.
    it('is absent once no routine is active', () => {
      useAppState.mockReturnValue(baseAppState({ selectedExerciseId: 1, activeRoutineId: null }));
      render(<MemoryRouter><LogTab /></MemoryRouter>);

      expect(screen.queryByRole('button', { name: 'End routine' })).not.toBeInTheDocument();
    });
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


// Creating an exercise stopped opening its detail screen while ONLINE: handleExerciseCreated
// awaited an invalidation of queryKeys.exercises()/personExercises() -- the exact two keys
// insertOptimisticExercise had just written the new exercise into -- so the optimistic row was
// evicted milliseconds before selectExercise named it, and selectedExercise resolved to null.
// Offline the same await is a no-op (a paused query's invalidation resolves immediately), which is
// why every existing spec ran in a mode where the bug is invisible. See
// docs/incidents/2026-08-19-exercise-create-navigation-lost-online.md.
describe('opening a newly created exercise', () => {
  // Never-settling refetches. This is the whole point of the test: if handleExerciseCreated ever
  // awaits one of these again, selectExercise is never reached and the assertions below fail --
  // which is exactly the shape the online bug had.
  const neverSettles = () => vi.fn(() => new Promise(() => {}));

  beforeEach(() => {
    vi.clearAllMocks();
    clearExerciseIdMap();
    useUI.mockReturnValue({ showToast: vi.fn() });
    useExercises.mockReturnValue({ exercises: [], loading: false, refetch: neverSettles() });
    usePersonExercises.mockReturnValue({ exercises: [], loading: false, refetch: neverSettles() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: neverSettles() });
    useRoutines.mockReturnValue({ routines: [], loading: false, isFetching: false, updatedAt: Date.now() });
    useLiveSession.mockReturnValue({ session: null, refetch: vi.fn() });
    useHistory.mockReturnValue({ history: [], loading: false, refetch: vi.fn() });
    useSessionEntries.mockReturnValue([]);
  });

  afterEach(() => clearExerciseIdMap());

  it('selects the new exercise immediately, without waiting on a catalog refetch', async () => {
    const appState = baseAppState({ selectedExerciseId: null, activeRoutineId: null });
    useAppState.mockReturnValue(appState);
    renderWithQuery(<MemoryRouter><LogTab /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'mock-add-own' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add', exact: true }));

    // The optimistic temp id, selected straight off the row the modal just wrote into the cache.
    // The temp -> real swap happens later, via LogTab's mutation-cache subscription.
    await waitFor(() => expect(appState.selectExercise).toHaveBeenCalledTimes(1));
    expect(appState.selectExercise).toHaveBeenCalledWith(expect.stringMatching(/^temp-exercise-/));
  });

  it('migrates a restored temp selection to the real id already waiting in the map', () => {
    // The mutation-cache subscription only ever sees mappings recorded from the moment it
    // subscribes. A create can sync while LogTab is unmounted -- another tab, or during boot --
    // leaving a temp selection restored from persisted state with a real id already on hand.
    setExerciseIdMapping('temp-exercise-restored', 4242);
    const appState = baseAppState({ selectedExerciseId: 'temp-exercise-restored', activeRoutineId: null });
    useAppState.mockReturnValue(appState);

    renderWithQuery(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(appState.selectExercise).toHaveBeenCalledWith(4242);
  });

  it('leaves an unmapped temp selection alone', () => {
    // Still queued in the outbox: the temp id is the right thing to be looking at, and the
    // subscription will migrate it when the create syncs.
    const appState = baseAppState({ selectedExerciseId: 'temp-exercise-queued', activeRoutineId: null });
    useAppState.mockReturnValue(appState);

    renderWithQuery(<MemoryRouter><LogTab /></MemoryRouter>);

    expect(appState.selectExercise).not.toHaveBeenCalled();
  });
});
