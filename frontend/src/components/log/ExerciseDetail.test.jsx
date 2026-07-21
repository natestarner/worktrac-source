import { useState } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import ExerciseDetail from './ExerciseDetail';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { getExerciseSummary } from '../../api/stats';
import { listSessionSets, logLiveSet, logSetIntoSession } from '../../api/sets';
import { getSessionExerciseNote, saveLiveExerciseNote, saveSessionExerciseNote } from '../../api/notes';

// ExerciseDetail's handleLogSet only starts the 90s rest timer for a LIVE set --
// never for a set logged while editing a past/retroactive session. This is the one
// behavior in the requirements that structurally needs a rendered component (it's about
// which context function fires from an event handler, not a pure calculation), so this
// is the sole RTL component test in the suite for this pass; the surrounding hooks are
// mocked out rather than rendering the real providers.
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../api/stats', () => ({ getExerciseSummary: vi.fn() }));
vi.mock('../../api/sets', () => ({
  listSessionSets: vi.fn(),
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  deleteSet: vi.fn(),
}));
vi.mock('../../api/exercises', () => ({
  listCustomFields: vi.fn().mockResolvedValue([]),
  addCustomField: vi.fn(),
  updateCustomField: vi.fn(),
  removeCustomField: vi.fn(),
  setExerciseTags: vi.fn(),
  updateExercise: vi.fn(),
  removeExercise: vi.fn(),
  favoriteExercise: vi.fn(),
  unfavoriteExercise: vi.fn(),
}));
vi.mock('../../api/notes', () => ({
  getSessionExerciseNote: vi.fn(),
  saveLiveExerciseNote: vi.fn(),
  saveSessionExerciseNote: vi.fn(),
}));
const exercise = { id: 1, name: 'Bench Press', tags: [], isFavorite: true, setupFields: [] };

function renderExerciseDetail(props = {}) {
  return renderWithQuery(
    <ExerciseDetail
      exercise={exercise}
      personId={7}
      editingSessionId={null}
      liveSession={null}
      refetchLiveSession={vi.fn().mockResolvedValue()}
      onBack={vi.fn()}
      {...props}
    />,
  );
}

describe('ExerciseDetail rest-timer live-vs-retroactive gating', () => {
  let startRestTimer;

  beforeEach(() => {
    vi.clearAllMocks();
    startRestTimer = vi.fn();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue({ weightDraft: 135, repsDraft: 8, setWeightDraft: vi.fn(), setRepsDraft: vi.fn() });
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer, openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    logSetIntoSession.mockResolvedValue({ isPR: false, best: null, session: { id: 102 }, set: { id: 202 } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts the rest timer when logging a live set', async () => {
    renderExerciseDetail({ editingSessionId: null });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    expect(startRestTimer).toHaveBeenCalledWith(7, 90);
  });

  it('does not start the rest timer when logging a set while editing a past session', async () => {
    renderExerciseDetail({ editingSessionId: 55 });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() =>
      expect(logSetIntoSession).toHaveBeenCalledWith(55, expect.objectContaining({ exerciseId: 1, weight: 135, reps: 8 })),
    );
    expect(startRestTimer).not.toHaveBeenCalled();
  });
});

// A bodyweight set (weight === 0) makes Epley's 1RM estimate meaningless -- it collapses
// to 0 regardless of reps -- so the celebration payload should surface the rep count
// instead. Mirrors the same weight-0 convention as comparableLb in utils/formulas.js.
describe('ExerciseDetail PR celebration payload', () => {
  let showCelebration;

  beforeEach(() => {
    vi.clearAllMocks();
    showCelebration = vi.fn();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue({ weightDraft: 0, repsDraft: 12, setWeightDraft: vi.fn(), setRepsDraft: vi.fn() });
    useUI.mockReturnValue({ showCelebration, showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the rep count instead of a weight/1RM calc for a bodyweight PR', async () => {
    logLiveSet.mockResolvedValue({
      isPR: true,
      best: { weight: 0, reps: 12, unit: 'lb', est1rm: 0 },
      session: { id: 101 },
      set: { id: 201 },
    });
    renderExerciseDetail();

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() =>
      expect(showCelebration).toHaveBeenCalledWith(expect.objectContaining({ isBodyweight: true, est1rmText: '12 reps' })),
    );
  });

  it('shows the normal weight/1RM calc for a weighted PR', async () => {
    useAppState.mockReturnValue({ weightDraft: 185, repsDraft: 5, setWeightDraft: vi.fn(), setRepsDraft: vi.fn() });
    logLiveSet.mockResolvedValue({
      isPR: true,
      best: { weight: 185, reps: 5, unit: 'lb', est1rm: 208 },
      session: { id: 101 },
      set: { id: 201 },
    });
    renderExerciseDetail();

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() =>
      expect(showCelebration).toHaveBeenCalledWith(expect.objectContaining({ isBodyweight: false, est1rmText: '208 lb' })),
    );
  });
});

// The session note glyph must be ghosted with no callout when the current session has no
// note, and filled with a readable callout once one exists -- see ExerciseDetail.jsx's
// sessionNote state and the pinnedNoteStyle/sessionNoteStyle callouts. Saving before any
// set is logged still must go through the live-note endpoint (mirrors handleLogSet).
describe('ExerciseDetail exercise notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue({ weightDraft: 135, repsDraft: 8, setWeightDraft: vi.fn(), setRepsDraft: vi.fn() });
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a ghosted glyph and no callout when the session has no note', async () => {
    getSessionExerciseNote.mockResolvedValue(null);
    renderExerciseDetail({ liveSession: { id: 101 } });

    expect(await screen.findByRole('button', { name: 'Add a note for this session' })).toBeInTheDocument();
    expect(screen.queryByText('Shoulder felt off today')).not.toBeInTheDocument();
  });

  it('shows a filled glyph and a callout once the session has a note', async () => {
    getSessionExerciseNote.mockResolvedValue({ sessionId: 101, exerciseId: 1, note: 'Shoulder felt off today' });
    renderExerciseDetail({ liveSession: { id: 101 } });

    expect(await screen.findByRole('button', { name: 'Edit note for this session' })).toBeInTheDocument();
    expect(screen.getByText('Shoulder felt off today')).toBeInTheDocument();
  });

  it('surfaces the previous session note in the Last time card', async () => {
    getExerciseSummary.mockResolvedValue({
      lastSession: { sessionId: 55, startedAt: '2026-07-01T12:00:00Z', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: 'Felt strong' },
      best: null,
    });
    getSessionExerciseNote.mockResolvedValue(null);
    renderExerciseDetail();

    expect(await screen.findByText('Felt strong')).toBeInTheDocument();
  });

  it('saves a note before any set is logged through the live-note endpoint', async () => {
    const showToast = vi.fn();
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast, startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getSessionExerciseNote.mockResolvedValue(null);
    saveLiveExerciseNote.mockResolvedValue({ sessionId: 101, exerciseId: 1, note: 'Cut it short' });
    renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByRole('button', { name: 'Add a note for this session' }));
    fireEvent.change(screen.getByPlaceholderText('Write a note...'), { target: { value: 'Cut it short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveLiveExerciseNote).toHaveBeenCalledWith(7, { exerciseId: 1, note: 'Cut it short' }));
    expect(showToast).toHaveBeenCalledWith('Note saved');
    expect(saveSessionExerciseNote).not.toHaveBeenCalled();
  });

  it('saves through the explicit-session endpoint when editing a past session', async () => {
    getSessionExerciseNote.mockResolvedValue(null);
    saveSessionExerciseNote.mockResolvedValue({ sessionId: 55, exerciseId: 1, note: 'Backfilled note' });
    renderExerciseDetail({ editingSessionId: 55, liveSession: null });

    fireEvent.click(await screen.findByRole('button', { name: 'Add a note for this session' }));
    fireEvent.change(screen.getByPlaceholderText('Write a note...'), { target: { value: 'Backfilled note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveSessionExerciseNote).toHaveBeenCalledWith(55, 1, 'Backfilled note'));
    expect(saveLiveExerciseNote).not.toHaveBeenCalled();
  });
});

// The summary/sets/etc. are keyed on personId (and the component is remounted via key={personId}
// at the LogTab call site), so switching people can never surface the previous person's numbers.
describe('ExerciseDetail per-person isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue({ weightDraft: 135, repsDraft: 8, setWeightDraft: vi.fn(), setRepsDraft: vi.fn() });
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
    // Each person's summary is distinct; the mock answers by personId.
    getExerciseSummary.mockImplementation((pid) =>
      Promise.resolve({
        lastSession: { startedAt: '2026-07-01T12:00:00Z', sets: [{ weight: pid === 7 ? 100 : 250, reps: 5, unit: 'lb' }] },
        best: null,
      }),
    );
  });

  afterEach(() => vi.clearAllMocks());

  it("shows the active person's last-time card, never the previous person's, on switch", async () => {
    function Harness() {
      const [pid, setPid] = useState(7);
      return (
        <div>
          <button onClick={() => setPid(8)}>switch</button>
          <ExerciseDetail
            key={pid}
            exercise={exercise}
            personId={pid}
            editingSessionId={null}
            liveSession={null}
            refetchLiveSession={vi.fn().mockResolvedValue()}
            onBack={vi.fn()}
          />
        </div>
      );
    }
    renderWithQuery(<Harness />);

    expect(await screen.findByText('100lb×5')).toBeInTheDocument();

    fireEvent.click(screen.getByText('switch'));

    expect(await screen.findByText('250lb×5')).toBeInTheDocument();
    expect(screen.queryByText('100lb×5')).not.toBeInTheDocument();
  });
});

// The old handleLogSet had no error handling: a failed write was silent. Now a failure surfaces a
// message (and rolls back the optimistic set), so a logged set is never silently lost.
describe('ExerciseDetail write-failure handling', () => {
  let showToast;

  beforeEach(() => {
    vi.clearAllMocks();
    showToast = vi.fn();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue({ weightDraft: 135, repsDraft: 8, setWeightDraft: vi.fn(), setRepsDraft: vi.fn() });
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast, startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('surfaces a message when a set fails to save (no more silent failures)', async () => {
    const clientError = Object.assign(new Error('Weight required'), { status: 400 });
    logLiveSet.mockRejectedValue(clientError);
    renderExerciseDetail({ liveSession: { id: 101 } });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Weight required'));
  });
});

// A tap that doesn't visibly acknowledge itself invites a second tap and reads as broken --
// each of these controls must show *something* is happening while its request is in flight,
// even though the underlying writes (optimistic set insert, near-instant favorite toggle) are
// often too fast to notice most of the time.
describe('ExerciseDetail in-flight visual feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue({ weightDraft: 135, repsDraft: 8, setWeightDraft: vi.fn(), setRepsDraft: vi.fn() });
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('re-enables the Log Set button once the optimistic write lands, without waiting for the server', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockReturnValue(new Promise((resolve) => { resolveLog = resolve; }));
    renderExerciseDetail({ liveSession: { id: 101 } });

    const button = (await screen.findByText('Log set')).closest('button');
    fireEvent.click(button);

    // The button's pending window is scoped to the optimistic cache write (which has no
    // network dependency), not the full request -- it should clear quickly even though the
    // mocked request below is still unresolved. This matters because with the old
    // mutateAsync-based wiring, the button would otherwise never re-enable if the request
    // were paused offline (see the offline test below) -- there's no timeout on that promise.
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(logLiveSet).toHaveBeenCalled();
    expect(await screen.findByText(/Saving/)).toBeInTheDocument();

    resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
    await waitFor(() => expect(screen.queryByText(/Saving/)).not.toBeInTheDocument());
  });

  it("shows \"Will sync once you're back online\" while paused offline, then Saving once reconnected", async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockImplementation(() => new Promise((resolve) => { resolveLog = resolve; }));
    renderExerciseDetail({ liveSession: { id: 101 } });

    onlineManager.setOnline(false);
    try {
      const button = (await screen.findByText('Log set')).closest('button');
      fireEvent.click(button);

      // The tap-ack still resolves promptly even offline -- onMutate's cache write has no
      // network dependency -- so the button must not hang the way it would have under the
      // old mutateAsync-based wiring.
      await waitFor(() => expect(button).not.toBeDisabled());
      // TanStack pauses the mutation before ever invoking mutationFn while offline.
      expect(logLiveSet).not.toHaveBeenCalled();
      expect(await screen.findByText("Will sync once you're back online")).toBeInTheDocument();
      expect(screen.queryByText(/Saving/)).not.toBeInTheDocument();

      onlineManager.setOnline(true);
      await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
      expect(await screen.findByText(/Saving/)).toBeInTheDocument();
      expect(screen.queryByText("Will sync once you're back online")).not.toBeInTheDocument();

      listSessionSets.mockResolvedValue([{ id: 201, weight: 135, reps: 8, unit: 'lb' }]);
      resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
      await waitFor(() => expect(screen.getByText('Edit')).toBeInTheDocument());
    } finally {
      // Restore the real default -- onlineManager's #online starts at `true` with no
      // navigator.onLine fallback in this TanStack version, so setOnline(undefined) would
      // leave it falsy (behaving as offline) rather than resetting it, leaking into every
      // later test in this file/run that shares this module-level singleton.
      onlineManager.setOnline(true);
    }
  });

  it('disables and pulses the favorite star until the toggle settles', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveToggle;
    // exercise.isFavorite starts true, so a click calls unfavoriteExercise.
    const { unfavoriteExercise } = await import('../../api/exercises');
    unfavoriteExercise.mockReturnValue(new Promise((resolve) => { resolveToggle = resolve; }));
    renderExerciseDetail();

    const star = await screen.findByRole('button', { name: 'Remove from favorites' });
    fireEvent.click(star);

    await waitFor(() => expect(star).toBeDisabled());
    expect(star.className).toContain('favorite-star-pending');

    resolveToggle();

    await waitFor(() => expect(star).not.toBeDisabled());
    expect(star.className).not.toContain('favorite-star-pending');
  });

  it('shows a "Saving..." indicator (no Edit/Delete yet) on a set until it is confirmed', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockReturnValue(new Promise((resolve) => { resolveLog = resolve; }));
    renderExerciseDetail({ liveSession: { id: 101 } });

    fireEvent.click(await screen.findByText('Log set'));

    expect(await screen.findByText(/Saving/)).toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();

    listSessionSets.mockResolvedValue([{ id: 201, weight: 135, reps: 8, unit: 'lb' }]);
    resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });

    await waitFor(() => expect(screen.getByText('Edit')).toBeInTheDocument());
    expect(screen.queryByText(/Saving/)).not.toBeInTheDocument();
  });

  // Logging the very first set of a brand-new workout has no live session yet, so
  // onMutate has nowhere to write an optimistic row (queryKeys.sessionSets needs a real
  // session id). Without a placeholder, the "This session" section stays entirely absent
  // until the full create-session-and-log-set round trip completes -- these three tests
  // cover the skeleton placeholder that fills that gap (see pendingBeforeSession in
  // ExerciseDetail.jsx), derived from the shared MutationCache rather than local state.
  it('shows a skeleton placeholder for the very first set of a brand-new workout (no session yet)', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockReturnValue(new Promise((resolve) => { resolveLog = resolve; }));

    // A harness that actually updates liveSession when refetchLiveSession is called --
    // renderExerciseDetail's default stub just resolves without touching any state, which
    // would leave contextSessionId null forever and never let the confirmed row appear
    // (LogTab's real refetchLiveSession does update the liveSession it passes down).
    function Harness() {
      const [liveSession, setLiveSession] = useState(null);
      return (
        <ExerciseDetail
          exercise={exercise}
          personId={7}
          editingSessionId={null}
          liveSession={liveSession}
          refetchLiveSession={async () => setLiveSession({ id: 101 })}
          onBack={vi.fn()}
        />
      );
    }
    renderWithQuery(<Harness />);

    // Before the click there's no session and nothing to show in "This session" -- the
    // heading only renders once displaySets is non-empty.
    expect(screen.queryByText('This session')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByText('Log set'));

    expect(await screen.findByText('This session')).toBeInTheDocument();
    expect(screen.getByText(/Saving/)).toBeInTheDocument();

    listSessionSets.mockResolvedValue([{ id: 201, weight: 135, reps: 8, unit: 'lb' }]);
    resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });

    await waitFor(() => expect(screen.getByText('Edit')).toBeInTheDocument());
  });

  it('does not leak a pending placeholder into a different exercise after a mid-flight switch', async () => {
    const exerciseB = { id: 2, name: 'Squat', tags: [], isFavorite: false, setupFields: [] };
    listSessionSets.mockResolvedValue([]);
    let resolveLogA;
    logLiveSet.mockImplementation(() => new Promise((resolve) => { resolveLogA = resolve; }));

    function Harness() {
      const [currentExercise, setCurrentExercise] = useState(exercise);
      return (
        <div>
          <button onClick={() => setCurrentExercise(exerciseB)}>switch</button>
          <ExerciseDetail
            exercise={currentExercise}
            personId={7}
            editingSessionId={null}
            liveSession={null}
            refetchLiveSession={vi.fn().mockResolvedValue()}
            onBack={vi.fn()}
          />
        </div>
      );
    }
    renderWithQuery(<Harness />);

    fireEvent.click(await screen.findByText('Log set'));
    await waitFor(() => expect(screen.getByText('This session')).toBeInTheDocument());

    // ExerciseDetail isn't remounted on an exercise switch (LogTab keys it on personId
    // only, matched by this harness's lack of a key) -- switching mid-flight must not show
    // exercise A's still-pending placeholder under exercise B.
    fireEvent.click(screen.getByText('switch'));
    expect(screen.queryByText('This session')).not.toBeInTheDocument();

    // Settle exercise A's still-outstanding request so it doesn't leak into a later test;
    // wrapped in act since nothing else here awaits the resulting state update.
    await act(async () => {
      resolveLogA({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
      await Promise.resolve();
    });
  });

  it('removes the placeholder automatically if the first set fails to save', async () => {
    listSessionSets.mockResolvedValue([]);
    const showToast = vi.fn();
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast, startRestTimer: vi.fn(), openConfirm: vi.fn() });
    const clientError = Object.assign(new Error('Weight required'), { status: 400 });
    // Controlled rejection (not mockRejectedValue) -- an immediately-rejected promise can
    // leave 'pending' status before the placeholder assertion below ever gets to observe it.
    let rejectLog;
    logLiveSet.mockImplementation(() => new Promise((resolve, reject) => { rejectLog = reject; }));
    renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));
    expect(await screen.findByText('This session')).toBeInTheDocument();

    rejectLog(clientError);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Weight required'));
    // No manual cleanup code runs here -- the mutation leaving 'pending' status on its own
    // is what drops it from pendingBeforeSession.
    await waitFor(() => expect(screen.queryByText('This session')).not.toBeInTheDocument());
  });
});
