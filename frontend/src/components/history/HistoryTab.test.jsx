import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import HistoryTab from './HistoryTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useHistory } from '../../hooks/useHistory';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';
import { listPersonExercises } from '../../api/exercises';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useHistory', () => ({ useHistory: vi.fn() }));
vi.mock('../../hooks/useHistoryWindow', () => ({ useHistoryWindow: vi.fn() }));
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
    useHistoryWindow.mockReturnValue({ historyWindow: null });
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

  // ⚠️ The note is on its OWN line, not in the header row beside the exercise name. In that row it
  // was the only shrinkable item -- the name is flexShrink: 0 and the record badge has no flex
  // props, while the note carried minWidth: 0 + nowrap + ellipsis -- so it absorbed the whole
  // deficit. On a 390px phone with a Volume badge present that left it ~47px of text; with a long
  // exercise name it left the icon and nothing else.
  //
  // jsdom computes no layout, so this asserts the STRUCTURE that causes the squeeze rather than
  // the pixels: the note must not be a sibling of the exercise name inside the header row.
  it('puts the note on its own line rather than beside the exercise name', async () => {
    useHistory.mockReturnValue({
      loading: false,
      history: [
        {
          id: 103,
          startedAt: '2026-07-03T12:00:00Z',
          endedAt: '2026-07-03T13:00:00Z',
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

    const note = await screen.findByText('Shoulder felt off today');
    const name = screen.getByRole('button', { name: 'View options for Barbell Bench Press' });
    // The note must not be INSIDE the header button/row. That is the precise arrangement that
    // made the note the only item able to give up space: in the header row it sat next to a
    // flexShrink: 0 name and a badge with no flex props, so it absorbed the entire deficit.
    expect(name.contains(note)).toBe(false);
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

    expect(screen.getByRole('button', { name: 'Log a past workout' })).toBeDisabled();
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
    //
    // Matched as a PREFIX, not an exact string: the title now names which record fell
    // ("Personal record: top weight, est. 1RM"). The phrase itself is deliberately preserved --
    // see SetPillRow.jsx.
    await waitFor(() => expect(screen.getAllByTitle(/^Personal record/)).toHaveLength(3));
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

  // A tapped exercise now offers both destinations rather than jumping straight to one --
  // mirroring PRsTab's identical chooser (see its header comment for why neither is the default).
  it('tapping an exercise name offers both destinations rather than jumping straight to one', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getAllByRole('button', { name: 'View options for Bench Press' })[0]);

    // The chooser names the exercise, so it is obvious which row was tapped.
    expect(screen.getByRole('dialog')).toHaveTextContent('Bench Press');
    expect(screen.getByRole('button', { name: 'View this exercise’s history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View progress' })).toBeInTheDocument();
    // Opening the chooser must not filter or navigate by itself.
    expect(screen.queryByLabelText('Stop filtering to Bench Press')).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('"View progress" deep-links into Trends with that exercise seeded', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getAllByRole('button', { name: 'View options for Bench Press' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }));

    expect(mockNavigate).toHaveBeenCalledWith('/app/trends', {
      state: { trendsExerciseFocus: { exerciseId: 1 } },
    });
  });

  it('clicking an exercise name, then "View this exercise’s history", filters history to just that exercise', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getAllByRole('button', { name: 'View options for Bench Press' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'View this exercise’s history' }));

    // Both Bench Press sessions remain (2 exercise-name link buttons), plus the active-filter
    // pill itself also reads "Bench Press" -- Squat's session (no Bench Press entry) is gone.
    expect(screen.getAllByText('Bench Press')).toHaveLength(3);
    expect(screen.queryByText('Squat')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Stop filtering to Bench Press')).toBeInTheDocument(); // active-filter pill
  });

  it('the Edit button always dispatches the full, unfiltered session even while filtered', async () => {
    renderHistoryTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getAllByRole('button', { name: 'View options for Bench Press' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'View this exercise’s history' }));
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
    fireEvent.click(screen.getAllByRole('button', { name: 'View options for Bench Press' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'View this exercise’s history' }));
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

// The gap this closes: a Free household could log a past workout at an out-of-window date, tap
// Done, land here, and be told "No workouts logged yet" -- about a workout the app had just saved.
describe('HistoryTab and the Free-tier window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ activePersonId: 7, startEditingSession: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }], account: { plan: 'FREE' } });
    listPersonExercises.mockResolvedValue([]);
    useHistory.mockReturnValue({ loading: false, history: [] });
  });

  it('does not claim an empty window means nothing was ever logged', async () => {
    useHistoryWindow.mockReturnValue({
      historyWindow: { windowStart: '2026-03-17T12:00:00Z', hiddenSessions: 3, earliestHiddenAt: '2025-11-02T10:00:00Z' },
    });

    renderHistoryTab();

    expect(screen.queryByText(/No workouts logged yet/)).not.toBeInTheDocument();
    expect(await screen.findByText(/Your full history has 3 more workouts/)).toBeInTheDocument();
    // The export is full-history and unclamped, so a session hidden behind the window is still
    // something to download -- Export data must not read this the same as truly-empty history.
    expect(screen.getByRole('button', { name: 'Export data' })).not.toBeDisabled();
  });

  // The other side of the same branch: with nothing hidden, an empty History really is empty and
  // the original copy is the honest one.
  it('keeps the original copy for a person who really has never logged anything', async () => {
    useHistoryWindow.mockReturnValue({
      historyWindow: { windowStart: '2026-03-17T12:00:00Z', hiddenSessions: 0, earliestHiddenAt: null },
    });

    renderHistoryTab();

    expect(await screen.findByText('No workouts logged yet for Nate.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export data' })).toBeDisabled();
  });

  it('marks a populated but clipped list as incomplete', async () => {
    useHistory.mockReturnValue({
      loading: false,
      history: [
        {
          id: 101,
          startedAt: '2026-06-01T12:00:00Z',
          endedAt: '2026-06-01T13:00:00Z',
          entries: [{ exerciseId: 1, exerciseName: 'Squat', sets: [{ weight: 225, reps: 5, unit: 'lb' }], note: null }],
        },
      ],
    });
    useHistoryWindow.mockReturnValue({
      historyWindow: { windowStart: '2026-03-17T12:00:00Z', hiddenSessions: 12, earliestHiddenAt: '2025-01-02T10:00:00Z' },
    });

    renderHistoryTab();

    expect(await screen.findByText(/Your full history has 12 more workouts/)).toBeInTheDocument();
  });
});

// The legend explains three glyphs, which is worth its space only once there is something on
// screen wearing one. With one record colour (see index.css's --color-record-*) the glyph is the
// ENTIRE distinction between record types, which is what makes a key for them earn a row at all.
describe('HistoryTab record legend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ activePersonId: 7, startEditingSession: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    listPersonExercises.mockResolvedValue([]);
    useHistoryWindow.mockReturnValue({ historyWindow: null });
  });

  const withSets = (sets) => ({
    loading: false,
    history: [
      {
        id: 201,
        startedAt: '2026-07-01T12:00:00Z',
        endedAt: '2026-07-01T13:00:00Z',
        entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets, note: null }],
      },
    ],
  });

  it('shows the legend once something on screen is badged', async () => {
    useHistory.mockReturnValue(withSets([{ weight: 135, reps: 8, unit: 'lb' }]));
    renderHistoryTab();

    expect(await screen.findByRole('note')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How records work' })).toHaveAttribute('href', '/app/help#history');
  });

  // ⚠️ Only the EARLIER session's set takes the records; the later one merely ties it and takes
  // none. This is the retired isPrSet tie rule's visible consequence, now gone: the Log screen
  // used to pill both, History badged one, and they were describing the same two sets.
  it('badges only the set that beat the running best, not every set that matches it', async () => {
    useHistory.mockReturnValue({
      loading: false,
      history: [
        {
          id: 301,
          startedAt: '2026-07-02T12:00:00Z',
          endedAt: '2026-07-02T13:00:00Z',
          entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: null }],
        },
        {
          id: 302,
          startedAt: '2026-07-01T12:00:00Z',
          endedAt: '2026-07-01T13:00:00Z',
          entries: [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 8, unit: 'lb' }], note: null }],
        },
      ],
    });
    renderHistoryTab();

    await screen.findAllByText('Bench Press');
    expect(screen.getAllByTitle(/^Personal record/)).toHaveLength(1);
  });

  it('renders no legend at all for a person with no history', async () => {
    useHistory.mockReturnValue({ loading: false, history: [] });
    renderHistoryTab();

    await screen.findByText(/No workouts logged yet/);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  // ⚠️ The legend repeats the badges' own words, and Playwright matches an accessible name as a
  // SUBSTRING. Left addressable it would add three matches to every `getByTitle(/Personal record/)`
  // count on this tab that are not records, only a description of them.
  it('does not add addressable badge names of its own', async () => {
    useHistory.mockReturnValue(withSets([{ weight: 135, reps: 8, unit: 'lb' }]));
    renderHistoryTab();

    await screen.findByRole('note');
    // One badged set on screen -> exactly one titled badge, legend notwithstanding.
    expect(screen.getAllByTitle(/^Personal record/)).toHaveLength(1);
  });
});
