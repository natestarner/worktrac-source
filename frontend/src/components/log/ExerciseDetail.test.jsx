import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExerciseDetail from './ExerciseDetail';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { getExerciseSummary } from '../../api/stats';
import { listSessionSets, logLiveSet, logSetIntoSession } from '../../api/sets';
import { listSetupValues } from '../../api/setupValues';

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
vi.mock('../../api/setupValues', () => ({ listSetupValues: vi.fn(), setSetupValue: vi.fn() }));
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
const exercise = { id: 1, name: 'Bench Press', tags: [], isFavorite: true, setupFields: [] };

function renderExerciseDetail(props = {}) {
  return render(
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
    useUI.mockReturnValue({ showCelebration: vi.fn(), startRestTimer, openConfirm: vi.fn() });
    getExerciseSummary.mockResolvedValue({ lastSession: null, best: null });
    listSessionSets.mockResolvedValue([]);
    listSetupValues.mockResolvedValue([]);
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

    await waitFor(() => expect(logSetIntoSession).toHaveBeenCalledWith(55, { exerciseId: 1, weight: 135, reps: 8 }));
    expect(startRestTimer).not.toHaveBeenCalled();
  });
});
