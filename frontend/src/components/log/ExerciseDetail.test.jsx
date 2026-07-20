import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
