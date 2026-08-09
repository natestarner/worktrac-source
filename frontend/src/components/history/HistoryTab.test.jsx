import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import HistoryTab from './HistoryTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useHistory } from '../../hooks/useHistory';
import { listPersonExercises } from '../../api/exercises';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useHistory', () => ({ useHistory: vi.fn() }));
vi.mock('../../api/exercises', () => ({ listPersonExercises: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderHistoryTab(routerProps) {
  return renderWithQuery(
    <MemoryRouter {...routerProps}>
      <HistoryTab />
    </MemoryRouter>,
  );
}

describe('HistoryTab session notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ activePersonId: 7, startEditingSession: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    listPersonExercises.mockResolvedValue([]);
  });

  it('shows the session note beneath the sets for an entry that has one', async () => {
    useHistory.mockReturnValue({
      loading: false,
      history: [
        {
          id: 101,
          startedAt: '2026-07-01T12:00:00Z',
          endedAt: '2026-07-01T13:00:00Z',
          entries: [
            {
              exerciseId: 1,
              exerciseName: 'Barbell Bench Press',
              sets: [{ weight: 135, reps: 8, unit: 'lb' }],
              note: 'Shoulder felt off today',
            },
          ],
        },
      ],
    });

    renderHistoryTab();

    expect(await screen.findByText('Shoulder felt off today')).toBeInTheDocument();
  });

  it('omits the note line for an entry with no note', async () => {
    useHistory.mockReturnValue({
      loading: false,
      history: [
        {
          id: 102,
          startedAt: '2026-07-02T12:00:00Z',
          endedAt: '2026-07-02T13:00:00Z',
          entries: [
            { exerciseId: 1, exerciseName: 'Barbell Bench Press', sets: [{ weight: 140, reps: 8, unit: 'lb' }], note: null },
          ],
        },
      ],
    });

    renderHistoryTab();

    expect(await screen.findByText('140lb×8')).toBeInTheDocument();
    // The note indicator is an icon now, not a literal emoji. Asserting on its
    // accessible name keeps this meaningful -- a /📝/ text query would pass
    // vacuously against an icon whether or not a note was rendered.
    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument();
  });
});

describe('HistoryTab offline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAppState.mockReturnValue({ activePersonId: 7, startEditingSession: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    listPersonExercises.mockResolvedValue([]);
    useHistory.mockReturnValue({ loading: false, history: [], updatedAt: new Date('2026-07-22T15:00:00').getTime() });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('shows the offline data notice only while offline', async () => {
    renderHistoryTab();
    await act(async () => {}); // let the background person-exercises (tag map) query settle
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByText(/Offline.*data as of/)).toBeInTheDocument();
  });

  it('disables "Log a past workout" and "Export data" while offline', async () => {
    onlineManager.setOnline(false);
    renderHistoryTab();
    await act(async () => {}); // let the background person-exercises (tag map) query settle

    expect(screen.getByRole('button', { name: '+ Log a past workout' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export data' })).toBeDisabled();
  });
});

describe('HistoryTab PR markers, search/tag filtering, and click-to-filter', () => {
  const benchSession1 = {
    id: 1,
    startedAt: '2026-07-01T12:00:00Z',
    endedAt: '2026-07-01T12:00:00Z',
    entries: [
      { exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: null },
      { exerciseId: 2, exerciseName: 'Squat', sets: [{ weight: 225, reps: 5, unit: 'lb' }], note: null },
    ],
  };
  const benchSession2 = {
    id: 2,
    startedAt: '2026-07-08T12:00:00Z',
    endedAt: '2026-07-08T12:00:00Z',
    entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 155, reps: 8, unit: 'lb' }], note: null }],
  };
  const history = [benchSession2, benchSession1];

  let startEditingSession;

  beforeEach(() => {
    vi.clearAllMocks();
    startEditingSession = vi.fn();
    useAppState.mockReturnValue({ activePersonId: 7, startEditingSession });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    listPersonExercises.mockResolvedValue([
      { id: 1, name: 'Bench Press', tags: [{ id: 10, name: 'Push' }] },
      { id: 2, name: 'Squat', tags: [{ id: 11, name: 'Legs' }] },
    ]);
    useHistory.mockReturnValue({ loading: false, history });
  });

  it('marks a set as a PR only when it beats the prior running best', async () => {
    renderHistoryTab();
    // benchSession1's 135 (Bench, first-ever) and 225 (Squat, first-ever) are both PRs; benchSession2's
    // 155 (Bench) beats the prior 135 best and is also a PR -- three PR pills total.
    await waitFor(() => expect(screen.getAllByTitle('Personal record')).toHaveLength(3));
  });

  it('renders each exercise row\'s applied tags', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' }); // wait for tags to settle
    // "Push"/"Legs" each appear twice: once as a filter-bar toggle chip, once as a read-only
    // chip on the matching row(s) -- getAllByText confirms the row chip rendered without being
    // ambiguous about which "Push" is meant.
    expect(screen.getAllByText('Push').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Legs').length).toBeGreaterThanOrEqual(2);
  });

  it('search filters entries by exercise name, dropping sessions left with none', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' }); // wait for tags (and thus the filter bar's tag row) to settle

    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'squat' } });

    expect(screen.getByText('Squat')).toBeInTheDocument();
    expect(screen.queryByText('Bench Press')).not.toBeInTheDocument();
  });

  it('tag filter narrows to matching exercises only', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getByRole('button', { name: 'Legs' }));

    expect(screen.getByText('Squat')).toBeInTheDocument();
    expect(screen.queryByText('Bench Press')).not.toBeInTheDocument();
  });

  it('clicking an exercise name filters history to just that exercise', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Show only Bench Press in history' })[0]);

    // Both Bench Press sessions remain (2 exercise-name link buttons), plus the active-filter
    // pill itself also reads "Bench Press" -- Squat's session (no Bench Press entry) is gone.
    expect(screen.getAllByText('Bench Press')).toHaveLength(3);
    expect(screen.queryByText('Squat')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Stop filtering to Bench Press')).toBeInTheDocument(); // active-filter pill
  });

  it('the Edit button always dispatches the full, unfiltered session even while filtered', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Show only Bench Press in history' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

    expect(startEditingSession).toHaveBeenCalledTimes(1);
    const editedSession = startEditingSession.mock.calls[0][0];
    // benchSession1 has 2 entries (Bench Press + Squat) even though the on-screen view was
    // filtered down to just Bench Press.
    expect(editedSession.entries).toHaveLength(editedSession.id === benchSession1.id ? 2 : 1);
  });

  it('Clear all restores the full unfiltered list', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'squat' } });
    expect(screen.queryByText('Bench Press')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Clear all'));
    expect(screen.getAllByText('Bench Press').length).toBeGreaterThan(0);
    expect(screen.getByText('Squat')).toBeInTheDocument();
  });

  it('seeds and applies an exercise filter arriving via router state, then scrubs it', async () => {
    renderHistoryTab({
      initialEntries: [{ pathname: '/app/history', state: { historyExerciseFilter: { exerciseId: 1, exerciseName: 'Bench Press' } } }],
    });
    await screen.findByRole('button', { name: 'Push' });

    expect(screen.queryByText('Squat')).not.toBeInTheDocument();
    // The scrub navigates (replace) back to the same pathname with state cleared.
    expect(mockNavigate).toHaveBeenCalledWith('/app/history', { replace: true, state: null });
  });

  it('shows a "Back to" link only when the seeded filter came from the Log tab, and it returns there', async () => {
    renderHistoryTab({
      initialEntries: [
        { pathname: '/app/history', state: { historyExerciseFilter: { exerciseId: 1, exerciseName: 'Bench Press', fromLog: true } } },
      ],
    });
    const backLink = await screen.findByText(/Back to Bench Press/);
    fireEvent.click(backLink);
    expect(mockNavigate).toHaveBeenCalledWith('/app/log');
  });

  it('does not show a "Back to" link for a plain (non-deep-linked) filter', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Show only Bench Press in history' })[0]);
    expect(screen.queryByText(/Back to Bench Press/)).not.toBeInTheDocument();
  });
});

describe('HistoryTab filter isolation across a person switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPersonExercises.mockResolvedValue([]);
    useHistory.mockReturnValue({
      loading: false,
      history: [
        {
          id: 1,
          startedAt: '2026-07-01T12:00:00Z',
          endedAt: '2026-07-01T12:00:00Z',
          entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: null }],
        },
      ],
    });
  });

  it('drops the filter when the active person changes (key remount)', async () => {
    useAppState.mockReturnValue({ activePersonId: 7, startEditingSession: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }, { id: 8, name: 'Sam' }] });
    const { rerender, queryClient } = renderHistoryTab();
    await screen.findByText('Bench Press');

    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'squat' } });
    expect(screen.queryByText('Bench Press')).not.toBeInTheDocument();

    useAppState.mockReturnValue({ activePersonId: 8, startEditingSession: vi.fn() });
    // Re-supply the same QueryClientProvider wrapper renderWithQuery set up initially --
    // rerender() replaces the WHOLE tree at the root, not just HistoryTab's children.
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HistoryTab />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Bench Press'); // the search text did not survive the person switch
  });
});
