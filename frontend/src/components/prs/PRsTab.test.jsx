import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import PRsTab from './PRsTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { getPrs } from '../../api/stats';
import { listPersonExercises } from '../../api/exercises';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/stats', () => ({ getPrs: vi.fn() }));
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
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    listPersonExercises.mockResolvedValue([]);
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
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn() });
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
    expect(screen.queryByText(/log a set to start the board/)).not.toBeInTheDocument();
  });

  it('tapping a PR row navigates to History pre-filtered to that exercise', async () => {
    renderPRsTab();
    await screen.findByRole('button', { name: 'Push' });

    fireEvent.click(screen.getByText('Bench Press'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/history', {
      state: { historyExerciseFilter: { exerciseId: 1, exerciseName: 'Bench Press' } },
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
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn() });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    expect(renderedNames()[0]).toMatch(/^Arnold Press/);
    expect(renderedNames()[2]).toMatch(/^Squat/);
  });

  it('orders by name when the person has chosen that sort', async () => {
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'name', setPrsSort: vi.fn() });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    expect(renderedNames()[0]).toMatch(/^Arnold Press/);
    expect(renderedNames()[1]).toMatch(/^Bench Press/);
    expect(renderedNames()[2]).toMatch(/^Squat/);
  });

  it('orders by estimated 1RM, heaviest first', async () => {
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'est1rm', setPrsSort: vi.fn() });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    expect(renderedNames()[0]).toMatch(/^Squat/);
    expect(renderedNames()[2]).toMatch(/^Arnold Press/);
  });

  it('persists the choice through the per-person store rather than local state', async () => {
    const setPrsSort = vi.fn();
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort });
    renderPRsTab();

    await waitFor(() => expect(screen.getByText('Squat')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'est1rm' } });
    expect(setPrsSort).toHaveBeenCalledWith('est1rm');
  });

  it('hides the sort control when there is nothing to sort', async () => {
    useAppState.mockReturnValue({ activePersonId: 7, prsSort: 'recent', setPrsSort: vi.fn() });
    getPrs.mockResolvedValue([]);
    renderPRsTab();

    await waitFor(() => expect(screen.getByText(/log a set to start the board/)).toBeInTheDocument());
    expect(screen.queryByLabelText('Sort')).not.toBeInTheDocument();
  });
});
