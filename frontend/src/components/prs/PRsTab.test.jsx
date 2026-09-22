import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import PRsTab from './PRsTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { getPrs } from '../../api/stats';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';
import { listPersonExercises } from '../../api/exercises';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/stats', () => ({ getPrs: vi.fn() }));
vi.mock('../../hooks/useHistoryWindow', () => ({ useHistoryWindow: vi.fn() }));
vi.mock('../../api/exercises', () => ({ listPersonExercises: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPRsTab() {
  return renderWithQuery(
    <MemoryRouter>
      <PRsTab />
    </MemoryRouter>,
  );
}

describe('PRsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn(), prsMeasure: 'est1rm', setPrsMeasure: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    listPersonExercises.mockResolvedValue([]);
    useHistoryWindow.mockReturnValue({ historyWindow: null });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('shows the weight/1RM calc for a weighted PR', async () => {
    getPrs.mockResolvedValue([
      {
        exerciseId: 1,
        exerciseName: 'Bench Press',
        best: { weight: 185, reps: 5, unit: 'lb', est1rm: 208, sessionStartedAt: '2026-07-01T00:00:00Z' },
      },
    ]);
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('208 lb')).toBeInTheDocument());
    expect(screen.getByText('185lb×5')).toBeInTheDocument();
  });

  it('shows reps instead of the weight/1RM calc for a bodyweight PR', async () => {
    getPrs.mockResolvedValue([
      {
        exerciseId: 2,
        exerciseName: 'Pull-Up',
        best: { weight: 0, reps: 12, unit: 'lb', est1rm: 0, sessionStartedAt: '2026-07-01T00:00:00Z' },
      },
    ]);
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('12 reps')).toBeInTheDocument());
    expect(screen.getByText('Bodyweight')).toBeInTheDocument();
    expect(screen.queryByText('0lb×12')).not.toBeInTheDocument();
  });

  it('shows the offline data notice for the cached list only once offline', async () => {
    getPrs.mockResolvedValue([
      { exerciseId: 1, exerciseName: 'Bench Press', best: { weight: 185, reps: 5, unit: 'lb', est1rm: 208, sessionStartedAt: '2026-07-01T00:00:00Z' } },
    ]);
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Bench Press')).toBeInTheDocument());
    await act(async () => {}); // let the background person-exercises (tag map) query settle too
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByText(/Offline.*data as of/)).toBeInTheDocument();
  });
});

describe('PRsTab tags, filtering, and row navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn(), prsMeasure: 'est1rm', setPrsMeasure: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    listPersonExercises.mockResolvedValue([
      { id: 1, name: 'Bench Press', tags: [{ id: 10, name: 'Push' }] },
      { id: 2, name: 'Squat', tags: [{ id: 11, name: 'Legs' }] },
    ]);
    getPrs.mockResolvedValue([
      { exerciseId: 1, exerciseName: 'Bench Press', best: { weight: 185, reps: 5, unit: 'lb', est1rm: 208, sessionStartedAt: '2026-07-01T00:00:00Z' } },
      { exerciseId: 2, exerciseName: 'Squat', best: { weight: 275, reps: 5, unit: 'lb', est1rm: 310, sessionStartedAt: '2026-07-02T00:00:00Z' } },
    ]);
  });
  afterEach(() => onlineManager.setOnline(true));

  it('renders each PR row\'s applied tags', async () => {
    renderPRsTab();
    await screen.findByRole('button', { name: 'Push' }); // wait for tags to settle
    // "Push"/"Legs" each appear twice: once as a filter-bar toggle chip, once as a read-only
    // chip on the matching row -- getAllByText confirms the row chip rendered without being
    // ambiguous about which "Push" is meant.
    expect(screen.getAllByText('Push')).toHaveLength(2);
    expect(screen.getAllByText('Legs')).toHaveLength(2);
  });

  it('search narrows the board and clears back with Clear all', async () => {
    renderPRsTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'squat' } });
    expect(screen.getByText('Squat')).toBeInTheDocument();
    expect(screen.queryByText('Bench Press')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Clear all'));
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Squat')).toBeInTheDocument();
  });

  it('tag filter narrows the board', async () => {
    renderPRsTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.queryByText('Squat')).not.toBeInTheDocument();
  });

  it('shows a distinct empty message for a filter matching nothing vs. never having any PRs', async () => {
    renderPRsTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'deadlift' } });
    expect(screen.getByText('No exercises match this filter.')).toBeInTheDocument();
    expect(screen.queryByText(/board starts filling in/)).not.toBeInTheDocument();
  });

  it('tapping a PR row offers both destinations rather than jumping straight to one', async () => {
    renderPRsTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getByText('Bench Press'));

    // The chooser names the exercise, so it is obvious which row was tapped.
    expect(screen.getByRole('dialog')).toHaveTextContent('Bench Press');
    expect(screen.getByRole('button', { name: 'View this exercise’s history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View progress' })).toBeInTheDocument();
    // Opening the chooser must not navigate by itself.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('"View this exercise’s history" deep-links into History pre-filtered to that exercise', async () => {
    renderPRsTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getByText('Bench Press'));
    fireEvent.click(screen.getByRole('button', { name: 'View this exercise’s history' }));

    expect(mockNavigate).toHaveBeenCalledWith('/app/history', {
      state: { historyExerciseFilter: { exerciseId: 1, exerciseName: 'Bench Press' } },
    });
  });

  it('"View progress" deep-links into Trends with that exercise seeded', async () => {
    renderPRsTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getByText('Bench Press'));
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }));

    expect(mockNavigate).toHaveBeenCalledWith('/app/trends', {
      state: { trendsExerciseFocus: { exerciseId: 1 } },
    });
  });
});

describe('PRsTab sorting', () => {
  // Deliberately arranged so every sort produces a DIFFERENT order -- otherwise a test can pass
  // while the sort key is being ignored entirely.
  const rows = [
    { exerciseId: 1, exerciseName: 'Bench Press', best: { weight: 185, reps: 5, unit: 'lb', est1rm: 208, sessionStartedAt: '2026-07-01T00:00:00Z' } },
    { exerciseId: 2, exerciseName: 'Arnold Press', best: { weight: 95, reps: 8, unit: 'lb', est1rm: 120, sessionStartedAt: '2026-08-05T00:00:00Z' } },
    { exerciseId: 3, exerciseName: 'Squat', best: { weight: 275, reps: 5, unit: 'lb', est1rm: 310, sessionStartedAt: '2026-06-02T00:00:00Z' } },
  ];

  // Row order as rendered: each row's name is the first bold line inside its button.
  const renderedNames = () =>
    screen.getAllByRole('button').map((b) => b.textContent).filter((t) => rows.some((r) => t.startsWith(r.exerciseName)));

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    listPersonExercises.mockResolvedValue([]);
    getPrs.mockResolvedValue(rows);
  });
  afterEach(() => onlineManager.setOnline(true));

  it('defaults to most-recent order, absorbing the job the Trends Recent PRs card used to do', async () => {
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn(), prsMeasure: 'est1rm', setPrsMeasure: vi.fn() });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    expect(renderedNames()[0]).toMatch(/^Arnold Press/);
    expect(renderedNames()[2]).toMatch(/^Squat/);
  });

  it('orders by name when the person has chosen that sort', async () => {
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'name', setPrsSort: vi.fn(), prsMeasure: 'est1rm', setPrsMeasure: vi.fn() });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    expect(renderedNames()[0]).toMatch(/^Arnold Press/);
    expect(renderedNames()[1]).toMatch(/^Bench Press/);
    expect(renderedNames()[2]).toMatch(/^Squat/);
  });

  // 'est1rm' is the LEGACY persisted sort value, from before the board had a record picker. It has
  // to keep working: an install that predates the picker hydrates with it, and falling through to
  // the unknown-key default would silently move those people back to "Most recent".
  it('orders by the selected record, best first -- including from the legacy est1rm sort value', async () => {
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'est1rm', setPrsSort: vi.fn(), prsMeasure: 'est1rm', setPrsMeasure: vi.fn() });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    expect(renderedNames()[0]).toMatch(/^Squat/);
    expect(renderedNames()[2]).toMatch(/^Arnold Press/);
  });

  it('persists the choice through the per-person store rather than local state', async () => {
    const setPrsSort = vi.fn();
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort, prsMeasure: 'est1rm', setPrsMeasure: vi.fn() });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'record' } });
    expect(setPrsSort).toHaveBeenCalledWith('record');
  });

  it('names the value-based sort after the selected record, so the two controls agree', async () => {
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn(), prsMeasure: 'heaviest', setPrsMeasure: vi.fn() });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Heaviest weight' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Best est. 1RM' })).not.toBeInTheDocument();
  });

  it('hides the sort control when there is nothing to sort', async () => {
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn(), prsMeasure: 'est1rm', setPrsMeasure: vi.fn() });
    getPrs.mockResolvedValue([]);
    renderPRsTab();

    await waitFor(() => expect(screen.getByText(/board starts filling in/)).toBeInTheDocument());
    expect(screen.queryByLabelText('Sort')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Record')).not.toBeInTheDocument();
  });
});

describe('PRsTab record picker', () => {
  // A loaded lift, a bodyweight lift and a hold -- the three shapes that decide which measures
  // exist. Each carries the measures the backend would send for it, including the nulls.
  const loaded = {
    exerciseId: 1,
    exerciseName: 'Bench Press',
    best: { weight: 185, reps: 5, unit: 'lb', est1rm: 208, sessionStartedAt: '2026-07-01T00:00:00Z' },
    measures: {
      heaviest: { value: 225, weightLb: 225, reps: 1, sessionStartedAt: '2026-07-09T00:00:00Z' },
      sessionVolume: { value: 4625, weightLb: null, reps: null, sessionStartedAt: '2026-07-01T00:00:00Z' },
      bestSetVolume: { value: 925, weightLb: 185, reps: 5, sessionStartedAt: '2026-07-01T00:00:00Z' },
      totalReps: { value: 25, weightLb: null, reps: null, sessionStartedAt: '2026-07-01T00:00:00Z' },
    },
    bodyweightOnly: false,
    durationTracked: false,
  };
  const pullUp = {
    exerciseId: 2,
    exerciseName: 'Pull-Up',
    best: { weight: 0, reps: 12, unit: 'lb', est1rm: 0, sessionStartedAt: '2026-07-02T00:00:00Z' },
    measures: { heaviest: null, sessionVolume: null, bestSetVolume: null, totalReps: { value: 40, weightLb: null, reps: null, sessionStartedAt: '2026-07-02T00:00:00Z' } },
    bodyweightOnly: true,
    durationTracked: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }], account: { defaultUnit: 'lb' } });
    listPersonExercises.mockResolvedValue([]);
    useHistoryWindow.mockReturnValue({ historyWindow: null });
  });

  function mockState(prsMeasure, setPrsMeasure = vi.fn()) {
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn(), prsMeasure, setPrsMeasure });
  }

  it('re-measures every row when the record changes', async () => {
    getPrs.mockResolvedValue([loaded]);
    mockState('heaviest');
    renderPRsTab();

    // The top weight and the set behind it -- not the est. 1RM, which is a different set.
    await waitFor(() => expect(screen.getByText('225 lb')).toBeInTheDocument());
    expect(screen.queryByText('208 lb')).not.toBeInTheDocument();
  });

  // Volume and Best set are the pair most easily conflated, and the board shows no difference
  // between a session total and one set beyond this caption. Asserted as two renders rather than a
  // rerender, because renderWithQuery owns the QueryClientProvider.
  it('labels Volume as a session total', async () => {
    getPrs.mockResolvedValue([loaded]);
    mockState('sessionVolume');
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('4625 lb')).toBeInTheDocument());
    expect(screen.getByText('One session')).toBeInTheDocument();
  });

  it('labels Best set with the single set behind it', async () => {
    getPrs.mockResolvedValue([loaded]);
    mockState('bestSetVolume');
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('925 lb')).toBeInTheDocument());
    expect(screen.getByText('185lb×5')).toBeInTheDocument();
    expect(screen.queryByText('One session')).not.toBeInTheDocument();
  });

  // ⚠️ Never a zero -- a column of "0 lb" is worse than no column. But no longer a bare em dash
  // either: a pull-up has no top weight and still HAS a record, and a dash said "nothing here"
  // about a row that has a number. "No record" and "no TOP WEIGHT record" looked identical, and
  // only the second was true. The fallback is that exercise's est.-1RM record, which for a
  // bodyweight lift is its rep count.
  it('falls back to the record it does have, never a zero, for an exercise this measure cannot rank', async () => {
    getPrs.mockResolvedValue([pullUp]);
    mockState('heaviest');
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('12 reps')).toBeInTheDocument());
    // The reason is on screen, not hidden behind hover -- this app is used on an iPad.
    expect(screen.getByText('Bodyweight')).toBeInTheDocument();
    expect(screen.queryByText('0 lb')).not.toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  // ⚠️ The fallback is DISPLAY only. measureEntry still returns null for these rows, so prSort
  // still groups them last and never coerces them to a number -- showing a rep count must not let
  // a pull-up outrank a genuinely light lift on a weight-based sort.
  it('still sorts an unmeasurable row last despite now showing a number', async () => {
    getPrs.mockResolvedValue([pullUp, loaded]);
    mockState('heaviest');
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('12 reps')).toBeInTheDocument());
    const names = screen.getAllByTestId('pr-row').map((r) => r.textContent);
    expect(names[names.length - 1]).toContain('Pull-Up');
  });

  // An em dash survives for the genuinely empty case -- a row with no record at all to fall back
  // on. That is the only thing a dash should ever have meant.
  it('still shows a dash when there is no record to fall back on', async () => {
    getPrs.mockResolvedValue([{ exerciseId: 12, exerciseName: 'Sled Push', best: null }]);
    mockState('heaviest');
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument());
  });

  it('still measures a bodyweight exercise by reps, which is its honest record', async () => {
    getPrs.mockResolvedValue([pullUp]);
    mockState('totalReps');
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('40 reps')).toBeInTheDocument());
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('sorts rows the record cannot measure to the bottom rather than tying them at zero', async () => {
    getPrs.mockResolvedValue([pullUp, loaded]);
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'record', setPrsSort: vi.fn(), prsMeasure: 'heaviest', setPrsMeasure: vi.fn() });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('225 lb')).toBeInTheDocument());
    const rows = screen.getAllByTestId('pr-row').map((r) => r.textContent);
    expect(rows[0]).toMatch(/^Bench Press/);
    expect(rows[1]).toMatch(/^Pull-Up/);
  });

  // resilience.md axis D: a PRs entry restored from a cache written before this shipped has no
  // `measures` at all. It must degrade to a dash, never throw -- and the DEFAULT record must keep
  // working, since it reads `best` exactly as it always did.
  const legacyRow = {
    exerciseId: 9,
    exerciseName: 'Row',
    best: { weight: 135, reps: 8, unit: 'lb', est1rm: 171, sessionStartedAt: '2026-07-03T00:00:00Z' },
  };

  it('keeps the default record correct for a row cached before measures existed', async () => {
    getPrs.mockResolvedValue([legacyRow]);
    mockState('est1rm');
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('171 lb')).toBeInTheDocument());
  });

  // resilience.md axis D: a row cached before `measures` shipped has none at all. It degrades to
  // the est.-1RM record it does carry -- which is strictly more useful than the dash it used to
  // show, and reads identically to any other row this measure cannot rank.
  it('degrades a legacy cached row to the record it does have, rather than throwing', async () => {
    getPrs.mockResolvedValue([legacyRow]);
    mockState('sessionVolume');
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('171 lb')).toBeInTheDocument());
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });

  it('explains what the selected record counts, from the same spec the chart reads', async () => {
    getPrs.mockResolvedValue([loaded]);
    mockState('sessionVolume');
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Bench Press')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'What this board is measuring' }));
    expect(screen.getByRole('note')).toHaveTextContent('It is a session total, not one set.');
  });
});

// windowLabel derives "the last N days" from the floor the SERVER reported, measured against the
// real clock -- that is the whole point of not hardcoding 90 anywhere on the client. So the fixture
// has to be anchored to now, not to a date literal that ages.
const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

describe('PRsTab and the Free-tier window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn(), prsMeasure: 'est1rm', setPrsMeasure: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }], account: { plan: 'FREE' } });
    listPersonExercises.mockResolvedValue([]);
  });

  // "Log a set and the board starts filling in" is advice someone whose sets are all behind the
  // already taken. Repeating it tells them their training never happened.
  it('does not tell a clipped household to go and log its first set', async () => {
    getPrs.mockResolvedValue([]);
    useHistoryWindow.mockReturnValue({
      historyWindow: { windowStart: ninetyDaysAgo, hiddenSessions: 8, earliestHiddenAt: '2025-02-02T10:00:00Z' },
    });

    renderPRsTab();

    expect(await screen.findByText('No records inside this window')).toBeInTheDocument();
    expect(screen.queryByText(/board starts filling in/)).not.toBeInTheDocument();
  });

  it('keeps the original copy when nothing is hidden', async () => {
    getPrs.mockResolvedValue([]);
    useHistoryWindow.mockReturnValue({
      historyWindow: { windowStart: ninetyDaysAgo, hiddenSessions: 0, earliestHiddenAt: null },
    });

    renderPRsTab();

    expect(await screen.findByText(/board starts filling in/)).toBeInTheDocument();
  });

  // The board itself is the misleading part: every row is a real record, just not necessarily the
  // person's real record, so the notice names what the bests actually cover.
  it('says what the bests on a populated board actually cover', async () => {
    getPrs.mockResolvedValue([
      {
        exerciseId: 1,
        exerciseName: 'Bench Press',
        best: { weight: 135, reps: 5, durationSeconds: null, unit: 'lb', est1rm: 157.5, sessionStartedAt: '2026-06-01T12:00:00Z' },
      },
    ]);
    useHistoryWindow.mockReturnValue({
      historyWindow: { windowStart: ninetyDaysAgo, hiddenSessions: 8, earliestHiddenAt: '2025-02-02T10:00:00Z' },
    });

    renderPRsTab();

    expect(await screen.findByText(/Bests here cover the last 90 days/)).toBeInTheDocument();
  });
});
