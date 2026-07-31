import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager, MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import { queryKeys } from '../../api/queryKeys';
import { registerOfflineMutationDefaults } from '../../lib/queryClient';
import ExerciseDetail from './ExerciseDetail';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { getExerciseSummary } from '../../api/stats';
import { editSet, listSessionSets, logLiveSet, logSetIntoSession } from '../../api/sets';
import { getSessionExerciseNote, saveLiveExerciseNote, saveSessionExerciseNote } from '../../api/notes';
import { getHistory } from '../../api/sessions';

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
  editSet: vi.fn(),
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
// Backs the offline/lie-fi fallback's useHistory() read -- defaults to empty so every existing
// test in this file (which doesn't care about history) is unaffected; the fallback tests below
// override this per-case.
vi.mock('../../api/sessions', () => ({
  getHistory: vi.fn().mockResolvedValue([]),
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

  it('allows editing/deleting a paused-offline set, then shows Saving once reconnected', async () => {
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
      // A paused-offline set is just as editable/deletable as a synced one now (see
      // offlineSetEdits.js) -- no more opaque "Will sync..." placeholder.
      expect(await screen.findByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.queryByText(/Saving/)).not.toBeInTheDocument();

      onlineManager.setOnline(true);
      await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
      expect(await screen.findByText(/Saving/)).toBeInTheDocument();
      expect(screen.queryByText('Edit')).not.toBeInTheDocument();

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

  it('toggles favorite through the durable mutation (no blocking spinner -- it is optimistic)', async () => {
    listSessionSets.mockResolvedValue([]);
    // exercise.isFavorite starts true, so a click unfavorites via the durable mutation.
    const { unfavoriteExercise } = await import('../../api/exercises');
    unfavoriteExercise.mockResolvedValue({});
    renderExerciseDetail();

    const star = await screen.findByRole('button', { name: 'Remove from favorites' });
    fireEvent.click(star);

    await waitFor(() => expect(unfavoriteExercise).toHaveBeenCalledWith(7, 1));
    // The star is never disabled now -- the toggle is optimistic and queues durably offline.
    expect(star).not.toBeDisabled();
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
  // cover the placeholder that fills that gap (see pendingBeforeSession in
  // ExerciseDetail.jsx), derived from the shared MutationCache rather than local state.
  it('shows the entered weight/reps for the very first set of a brand-new workout (no session yet) while its write is in flight', async () => {
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
    expect(screen.getByText('135 lb × 8')).toBeInTheDocument();
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

  // The weight/reps are already known (they're right in the mutation's own variables) the
  // instant a set is logged -- while genuinely offline there's no reason to show an opaque
  // shimmer instead of them, unlike the brief online round-trip above which still does.
  it('shows real weight/reps (not a skeleton) for the first set of a brand-new workout while paused offline', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByText('Log set'));

      expect(await screen.findByText('135 lb × 8')).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(logLiveSet).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('deleting a paused-offline set (before a session exists) cancels its pending create', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    useUI.mockReturnValue({
      showCelebration: vi.fn(),
      showToast: vi.fn(),
      startRestTimer: vi.fn(),
      openConfirm: (_msg, onConfirm) => onConfirm(),
    });
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByText('Log set'));
      expect(await screen.findByText('Delete')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => expect(screen.queryByText('135 lb × 8')).not.toBeInTheDocument());
      // Cancelled outright -- not left queued as a delete against a set id that doesn't exist.
      expect(queryClient.getMutationCache().getAll().filter((m) => m.state.status === 'pending')).toHaveLength(0);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // Editing a not-yet-synced set no longer touches its queued create at all -- it queues a
  // genuinely separate, durable EDIT_SET write targeting the create's tempId (resolved once the
  // create syncs, see queryClient.js's requireResolvedSetId/setSetIdMapping and
  // offlineSetEdits.js's patchPendingLogSetDisplay). This is what makes editing a pending set
  // behave identically to editing a synced one in every connectivity mode, and avoids both
  // reordering the create in the shared outbox scope and the backend's idempotency dedup silently
  // discarding the edit if the create had already reached the server under lie-fi.
  it('editing a paused-offline set shows the corrected values immediately and queues a separate EDIT_SET, without removing or recreating the create', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    editSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    const { queryClient } = renderExerciseDetail({ liveSession: { id: 101 } });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByText('Log set'));
      expect(await screen.findByText('135 lb × 8')).toBeInTheDocument();
      const createBefore = queryClient.getMutationCache().getAll().find((m) => m.options.mutationKey[0] === 'logSet');

      fireEvent.click(screen.getByText('Edit'));
      // Scoped to the modal dialog -- ExerciseDetail's own "log a new set" weight/reps steppers
      // stay mounted in the background behind the overlay and have their own "+"/"−" buttons too.
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getAllByText('+')[0]); // Weight stepper's "+" (Reps' is the second)
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      // The row shows the correction immediately...
      expect(await screen.findByText('140 lb × 8')).toBeInTheDocument();
      // ...but the CREATE itself was never removed or recreated -- same object, same slot in the
      // shared outbox scope, so it can't be pushed out of enqueue order the way the old
      // replacePendingLogSet approach could.
      const create = queryClient.getMutationCache().getAll().find((m) => m.options.mutationKey[0] === 'logSet');
      expect(create).toBe(createBefore);
      expect(logLiveSet).not.toHaveBeenCalled();
      // A separate, genuinely new EDIT_SET write carries the correction.
      const edit = queryClient.getMutationCache().getAll().find((m) => m.options.mutationKey[0] === 'editSet');
      expect(edit).toBeDefined();
      expect(edit.state.variables).toMatchObject({ weight: 140, reps: 8 });
      expect(editSet).not.toHaveBeenCalled(); // still paused offline
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // pendingBeforeSession sorts by clientLoggedAt rather than trusting raw mutation-cache order --
  // now purely defensive (editing no longer reorders the cache; see the test above and
  // ExerciseDetail.jsx's comment on pendingBeforeSession), but the underlying guarantee ("Set N"
  // labels are position-based, so they must reflect true logging order regardless of array order)
  // is still worth protecting directly: construct a genuine mismatch (a set arriving in the cache
  // AFTER an earlier one, but with an EARLIER clientLoggedAt) and confirm the labels still land on
  // true chronological order, not array/insertion order.
  it('keeps "Set N" labels in true chronological (clientLoggedAt) order even when cache/array order disagrees', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // never resolves -- stays paused
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      const button = (await screen.findByText('Log set')).closest('button');

      // "Set 2" (by array/insertion order): dispatched first, but with a LATER clientLoggedAt --
      // through the real UI flow.
      fireEvent.click(button);
      expect(await screen.findByText('135 lb × 8')).toBeInTheDocument();

      // "Set 1" (by true clientLoggedAt): dispatched SECOND against the mutation cache (bypassing
      // the mocked, static useAppState draft), but stamped with an EARLIER clientLoggedAt -- e.g.
      // an offline replay ordering quirk, independent of any edit.
      const mutationKey = ['logSet', 7, exercise.id];
      await act(async () => {
        new MutationObserver(queryClient, { ...queryClient.getMutationDefaults(mutationKey), mutationKey })
          .mutate({
            mode: 'live',
            personId: 7,
            sessionId: null,
            exerciseId: exercise.id,
            unit: 'lb',
            weight: 145,
            reps: 12,
            tempId: 'test-temp-2',
            idempotencyKey: 'test-idem-2',
            clientLoggedAt: new Date(Date.now() - 1000).toISOString(),
          })
          .catch(() => {});
      });

      // Despite arriving SECOND in the cache, its EARLIER clientLoggedAt puts it first on screen.
      const earlierRow = (await screen.findByText('145 lb × 12')).parentElement;
      expect(within(earlierRow).getByText('Set 1')).toBeInTheDocument();
      const laterRow = screen.getByText('135 lb × 8').parentElement;
      expect(within(laterRow).getByText('Set 2')).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // Nothing exists server-side to key a "session in progress" banner/dot on until this
  // queued write actually replays, so onMutate optimistically seeds a provisional session
  // (id: null, so it can never leak into contextSessionId/activeSessionId or any id-keyed
  // query -- see ExerciseDetail.jsx's onMutate) directly into the same liveSession cache
  // entry LogTab/PersonPillBar already read.
  it('seeds a provisional live session (id: null) while offline so the banner/dot can appear before syncing', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {}));
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(await screen.findByText('Log set'));

      await waitFor(() =>
        expect(queryClient.getQueryData(queryKeys.liveSession(7))).toEqual(
          expect.objectContaining({ id: null, startedAt: expect.any(String) }),
        ),
      );
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('keeps the earliest offline-logged start time across multiple sets before the session syncs', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {}));
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    onlineManager.setOnline(false);
    try {
      const button = (await screen.findByText('Log set')).closest('button');
      fireEvent.click(button);
      await waitFor(() => expect(queryClient.getQueryData(queryKeys.liveSession(7))).toBeTruthy());
      const firstStartedAt = queryClient.getQueryData(queryKeys.liveSession(7)).startedAt;

      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);

      // Still the first set's timestamp -- the second dispatch must not clobber it.
      expect(queryClient.getQueryData(queryKeys.liveSession(7)).startedAt).toBe(firstStartedAt);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // The seed is unconditional (not gated on online/offline): a set logged against a server that's
  // slow, unreachable, or down is just as "session started" as one logged genuinely offline --
  // the banner must never wait on a request that might take a while (or never) to confirm. The
  // ordinary fast online round-trip still reconciles to the real session within a fraction of a
  // second via refetchLiveSession/the registered invalidation, same as before.
  it('seeds a provisional live session immediately even for the ordinary online first-set round trip', async () => {
    listSessionSets.mockResolvedValue([]);
    let resolveLog;
    logLiveSet.mockImplementation(() => new Promise((resolve) => { resolveLog = resolve; }));
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));
    await waitFor(() => expect(logLiveSet).toHaveBeenCalled());

    expect(queryClient.getQueryData(queryKeys.liveSession(7))).toEqual(
      expect.objectContaining({ id: null, startedAt: expect.any(String) }),
    );

    await act(async () => {
      resolveLog({ isPR: false, best: null, session: { id: 101 }, set: { id: 201 } });
      await Promise.resolve();
    });
  });

  // The server-down repro: online (not paused), but the write never confirms because the backend
  // is unreachable. Once shouldRetryWrite's retries are exhausted (immediately here, since the
  // test client registers retry:false) the mutation settles into a transient (non-4xx) error --
  // this must render exactly like a paused-offline set (real numbers, Edit/Delete, no alarm),
  // not get stuck as an indefinite "Saving..." skeleton with no session banner.
  it('shows real weight/reps and stays editable -- not stuck on "Saving..." -- when a first set terminal-errors against an unreachable server', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockRejectedValue({ status: 500 });
    renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(screen.getByText('135 lb × 8')).toBeInTheDocument());
    expect(await screen.findByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText(/Saving/)).not.toBeInTheDocument();
  });

  it('seeds the provisional live session even when the first set terminal-errors against an unreachable server', async () => {
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockRejectedValue({ status: 503 });
    const { queryClient } = renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.liveSession(7))).toEqual(
        expect.objectContaining({ id: null, startedAt: expect.any(String) }),
      ),
    );
  });

  it('does not roll back the set or show an alarming toast for a transient (non-4xx) failure -- it stays queued instead', async () => {
    listSessionSets.mockResolvedValue([]);
    const showToast = vi.fn();
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast, startRestTimer: vi.fn(), openConfirm: vi.fn() });
    logLiveSet.mockRejectedValue({ status: 500 });
    renderExerciseDetail({ liveSession: null });

    fireEvent.click(await screen.findByText('Log set'));

    await waitFor(() => expect(screen.getByText('135 lb × 8')).toBeInTheDocument());
    expect(showToast).not.toHaveBeenCalled();
    expect(screen.getByText('This session')).toBeInTheDocument();
  });
});

// Regression tests: the "This session" sets column used to be gated on `ready`
// (!summaryQuery.isLoading && !customFieldsQuery.isLoading), even though displaySets
// (optimistic rows + sessionSets) needs neither query. Against a down/hanging backend,
// summaryQuery.isLoading can stay true for tens of seconds (15s timeout x retries), during
// which an already-logged (or already-synced) set would vanish from view for no reason. The
// sets column must render as soon as its own data is available, independent of the summary
// read's loading state -- only the summary cards legitimately wait on `ready`.
describe('ExerciseDetail sets list independent of the summary/PR read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue({ weightDraft: 135, repsDraft: 8, setWeightDraft: vi.fn(), setRepsDraft: vi.fn() });
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('renders an already-synced set immediately even while the summary/PR read is still hanging', async () => {
    getExerciseSummary.mockImplementation(() => new Promise(() => {})); // hangs -- simulates DB down
    listSessionSets.mockResolvedValue([{ id: 201, weight: 135, reps: 8, unit: 'lb' }]);
    renderExerciseDetail({ liveSession: { id: 101 } });

    expect(await screen.findByText('This session')).toBeInTheDocument();
    expect(screen.getByText('135 lb × 8')).toBeInTheDocument();
    // The summary cards, unlike the sets list, legitimately stay in their loading state.
    expect(screen.queryByText(/Last time/)).not.toBeInTheDocument();
  });

  it('renders a freshly-logged set immediately even while the summary/PR read is still hanging', async () => {
    getExerciseSummary.mockImplementation(() => new Promise(() => {})); // hangs -- simulates DB down
    listSessionSets.mockResolvedValue([]);
    logLiveSet.mockImplementation(() => new Promise(() => {})); // write also hangs against the down server
    renderExerciseDetail({ liveSession: { id: 101 } });

    fireEvent.click(await screen.findByText('Log set'));

    expect(await screen.findByText('This session')).toBeInTheDocument();
    expect(screen.getByText('135 lb × 8')).toBeInTheDocument();
    expect(screen.queryByText(/Last time/)).not.toBeInTheDocument();
  });
});

// Exercise Detail's "Last time"/"Best est. 1RM" card is interaction-scoped (queryKeys.exerciseSummary
// is keyed on personId + exerciseId + contextSessionId), so it's realistic to open a given
// (exercise, session) combination for the first time while the live query can't get an answer --
// either genuinely offline, or online-but-unreachable ("lie-fi"). Both must resolve from the
// already-warmed history cache (see offlineCacheWarm.js / exerciseSummaryFromHistory.js) instead
// of hanging on a skeleton or falsely showing "No sets yet"/"No PR yet".
describe('ExerciseDetail summary fallback to warmed history (offline + lie-fi)', () => {
  const historyWithBenchPress = [
    {
      id: 55,
      startedAt: '2026-07-01T12:00:00Z',
      endedAt: '2026-07-01T13:00:00Z',
      manual: false,
      entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: null }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [] });
    useAppState.mockReturnValue({ weightDraft: 135, repsDraft: 8, setWeightDraft: vi.fn(), setRepsDraft: vi.fn() });
    useUI.mockReturnValue({ showCelebration: vi.fn(), showToast: vi.fn(), startRestTimer: vi.fn(), openConfirm: vi.fn() });
    listSessionSets.mockResolvedValue([]);
    getSessionExerciseNote.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
  });

  it('derives Last time/Best est. 1RM from the warmed history cache when hard offline with no exerciseSummary cache entry', async () => {
    // Never resolves -- while offline, TanStack pauses the fetch before invoking this at all.
    getExerciseSummary.mockImplementation(() => new Promise(() => {}));

    // Seed the history cache directly rather than going through a live fetch: going offline
    // BEFORE render (as the real scenario requires, so exerciseSummary's own fetch is paused
    // rather than merely "still fetching") would equally pause history's own first fetch if it
    // had to happen live here -- exactly the bug this test is meant to prove is fixed. Seeding
    // models "history was already warmed while online, sometime before this component mounted",
    // which is what offlineCacheWarm.js actually guarantees in the real app.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
    registerOfflineMutationDefaults(queryClient, { retry: false });
    queryClient.setQueryData(queryKeys.history(7), historyWithBenchPress);

    onlineManager.setOnline(false);
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <ExerciseDetail
            exercise={exercise}
            personId={7}
            editingSessionId={null}
            liveSession={null}
            refetchLiveSession={vi.fn().mockResolvedValue()}
            onBack={vi.fn()}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText('135lb×8')).toBeInTheDocument();
      expect(screen.getByText(/171 lb\s*\(135lb×8\)/)).toBeInTheDocument();
      expect(getExerciseSummary).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('derives Last time/Best est. 1RM from the warmed history cache during lie-fi (fetch attempted but fails)', async () => {
    getHistory.mockResolvedValue(historyWithBenchPress);
    // Stays online per onlineManager, but the request itself fails -- e.g. a rejected fetch
    // against an unreachable backend. Test client has retry: false, so this settles fast.
    getExerciseSummary.mockRejectedValue(new Error('network error'));

    renderExerciseDetail();

    expect(await screen.findByText('135lb×8')).toBeInTheDocument();
    expect(screen.getByText(/171 lb\s*\(135lb×8\)/)).toBeInTheDocument();
    await waitFor(() => expect(getExerciseSummary).toHaveBeenCalled());
  });

  it('still shows the normal loading state (not a premature "No sets yet") while the request is merely slow, not paused or errored', async () => {
    getHistory.mockResolvedValue(historyWithBenchPress);
    getExerciseSummary.mockImplementation(() => new Promise(() => {})); // hangs -- online, still in flight

    renderExerciseDetail();

    await waitFor(() => expect(screen.queryByText(/Last time/)).not.toBeInTheDocument());
    expect(screen.queryByText('135lb×8')).not.toBeInTheDocument();
  });
});
