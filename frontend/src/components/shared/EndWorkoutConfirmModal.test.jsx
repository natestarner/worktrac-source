import { MutationObserver, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EndWorkoutConfirmModal from './EndWorkoutConfirmModal';
import { LOG_SET_MUTATION_KEY, queryClient } from '../../lib/queryClient';
import { isCreateInEndedWorkout, isSessionEnded } from '../../lib/endedSessions';
import { queryKeys } from '../../api/queryKeys';
import { noteWorkoutEnded } from '../../lib/reviewPrompt';

vi.mock('../../api/sets', () => ({
  logLiveSet: vi.fn(() => new Promise(() => {})),
  logSetIntoSession: vi.fn(() => new Promise(() => {})),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
}));
vi.mock('../../api/sessions', () => ({
  endWorkout: vi.fn(() => new Promise(() => {})),
  getLiveSession: vi.fn(() => new Promise(() => {})),
  getHistory: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../context/UIContext', () => ({ useUI: () => ({ clearRestTimer: vi.fn() }) }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: () => ({ setRestTimer: vi.fn() }) }));
vi.mock('../../lib/haptics', () => ({ tryHaptic: vi.fn() }));
vi.mock('../../lib/reviewPrompt', () => ({ noteWorkoutEnded: vi.fn(() => false) }));

const PERSON = 7;

// Logged with the create never landing -- the state the End tap is made in.
function logPendingSet(tempId, overrides = {}) {
  new MutationObserver(queryClient, { ...queryClient.getMutationDefaults(LOG_SET_MUTATION_KEY), mutationKey: LOG_SET_MUTATION_KEY })
    .mutate({
      mode: 'live', personId: PERSON, exerciseId: 1, weight: 0, reps: 8, unit: 'lb',
      tempId, idempotencyKey: `k-${tempId}`, clientLoggedAt: '2026-09-23T10:00:00Z', ...overrides,
    })
    .catch(() => {});
}

function endWorkout(onEnded = () => {}) {
  render(
    <QueryClientProvider client={queryClient}>
      <EndWorkoutConfirmModal personId={PERSON} onClose={() => {}} onEnded={onEnded} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'End workout' }));
}

// Ending a workout whose first set is still saving: the live session is the `{ id: null }`
// placeholder, so the End records the pending creates instead of an id, and the session they
// create is marked ended when it lands. docs/incidents/2026-09-23-end-workout-mid-save-resurrected.md
describe('EndWorkoutConfirmModal', () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    onlineManager.setOnline(true);
  });
  afterEach(() => {
    queryClient.clear();
    localStorage.clear();
  });

  it('records this person\'s pending live-set creates when the session has no id yet', () => {
    queryClient.setQueryData(queryKeys.liveSession(PERSON), { id: null, startedAt: '2026-09-23T10:00:00Z' });
    logPendingSet('optimistic-a');
    logPendingSet('optimistic-b');
    logPendingSet('optimistic-other-person', { personId: 8 });
    logPendingSet('optimistic-past-session', { mode: 'session', sessionId: 42 });

    endWorkout();

    expect(isCreateInEndedWorkout(PERSON, 'optimistic-a')).toBe(true);
    expect(isCreateInEndedWorkout(PERSON, 'optimistic-b')).toBe(true);
    // Not this person's live workout: another person's set, and a past-session edit.
    expect(isCreateInEndedWorkout(PERSON, 'optimistic-other-person')).toBe(false);
    expect(isCreateInEndedWorkout(PERSON, 'optimistic-past-session')).toBe(false);
  });

  // The known-id path is unchanged: the id is the marker, and no creates are recorded.
  it('marks the session id, and records no creates, when the session has one', () => {
    queryClient.setQueryData(queryKeys.liveSession(PERSON), { id: 55, startedAt: '2026-09-23T10:00:00Z' });
    logPendingSet('optimistic-a', { sessionId: 55 });

    endWorkout();

    expect(isSessionEnded(PERSON, 55)).toBe(true);
    expect(isCreateInEndedWorkout(PERSON, 'optimistic-a')).toBe(false);
  });

  // The rating schedule (lib/reviewPrompt.js) counts finished workouts by their sets, so the End
  // tap hands it the same count the recap shows -- including sets still queued offline. Counted AT
  // the tap, so a reload with the workout-done sheet open cannot lose it; the answer travels to
  // SessionBar, which asks only once the sheet closes.
  it('tells the rating schedule how many sets the ended workout had, and hands its answer on', () => {
    noteWorkoutEnded.mockClear();
    noteWorkoutEnded.mockReturnValueOnce(true);
    queryClient.setQueryData(queryKeys.liveSession(PERSON), { id: null, startedAt: '2026-09-23T09:00:00Z' });
    logPendingSet('optimistic-a');
    logPendingSet('optimistic-b');
    const onEnded = vi.fn();

    endWorkout(onEnded);

    expect(noteWorkoutEnded).toHaveBeenCalledTimes(1);
    expect(noteWorkoutEnded).toHaveBeenCalledWith({ setCount: 2 });
    expect(onEnded).toHaveBeenCalledWith({
      summary: expect.objectContaining({ exerciseCount: 1, setCount: 2 }),
      reviewDue: true,
    });
  });

  // Nothing logged means nothing to summarise: SessionBar shows the plain toast instead of a sheet.
  it('hands on no summary for a workout with nothing in it', () => {
    queryClient.setQueryData(queryKeys.liveSession(PERSON), { id: 55, startedAt: '2026-09-23T09:00:00Z' });
    const onEnded = vi.fn();

    endWorkout(onEnded);

    expect(onEnded).toHaveBeenCalledWith({ summary: null, reviewDue: false });
  });
});
