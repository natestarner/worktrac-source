import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ExerciseTrendSection from './ExerciseTrendSection';
import { usePrs } from '../../hooks/usePrs';
import { useExerciseTrend } from '../../hooks/useExerciseTrend';
import { useExerciseRecords } from '../../hooks/useExerciseRecords';

// This file is about the metric switcher's own orchestration -- which options it offers and what
// it plots -- not about the chart's rendering, which recharts can't do meaningfully in jsdom (see
// TrendsTab.test.jsx's identical reasoning for stubbing chart subcomponents). ExerciseRecordsTable
// already has its own bodyweightOnly coverage.
vi.mock('../../hooks/usePrs', () => ({ usePrs: vi.fn() }));
vi.mock('../../hooks/useExerciseTrend', () => ({ useExerciseTrend: vi.fn() }));
vi.mock('../../hooks/useExerciseRecords', () => ({ useExerciseRecords: vi.fn() }));
vi.mock('./ExerciseTrendChart', () => ({
  default: ({ metric }) => <div>chart-metric:{metric}</div>,
}));
vi.mock('./ExerciseRecordsTable', () => ({ default: () => <div>records-table</div> }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

const loggedExercises = [
  { exerciseId: 1, exerciseName: 'Pull-ups' },
  { exerciseId: 2, exerciseName: 'Bench Press' },
];

function setup({ bodyweightOnly, metric = 'est1rm', onMetricChange = vi.fn(), points = [] } = {}) {
  usePrs.mockReturnValue({ prs: loggedExercises });
  useExerciseTrend.mockReturnValue({ points, loading: false });
  useExerciseRecords.mockReturnValue({ records: { bodyweightOnly }, loading: false });

  render(
    <MemoryRouter>
      <ExerciseTrendSection
        personId={7}
        exerciseId={1}
        onSelectExercise={vi.fn()}
        weeks={12}
        metric={metric}
        onMetricChange={onMetricChange}
        defaultUnit="lb"
      />
    </MemoryRouter>,
  );
}

describe('ExerciseTrendSection metric switcher', () => {
  it('offers all five metrics for a weighted exercise', () => {
    setup({ bodyweightOnly: false });
    ['Est. 1RM', 'Top weight', 'Volume', 'Best set', 'Reps'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  // The bug being fixed: weight and weight x reps are always 0 for a bodyweight lift, so these
  // three metrics were flat zero lines no matter the rep count. Hidden, not disabled -- a column
  // of zeros is worse than no column (see ExerciseRecordsTable's identical bodyweightOnly branch).
  it('hides Top weight, Volume and Best set for a bodyweight-only exercise', () => {
    setup({ bodyweightOnly: true });
    expect(screen.getByRole('button', { name: 'Est. 1RM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reps' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Top weight' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volume' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Best set' })).not.toBeInTheDocument();
  });

  // trendsExerciseMetric is one preference shared across every exercise in the dropdown. Landing
  // on a bodyweight exercise while it's set to a hidden metric must fall back for DISPLAY only --
  // never overwrite the stored preference, or picking a weighted exercise again would lose it.
  it('falls back to est. 1RM for display when the stored preference is hidden here, without overwriting it', () => {
    const onMetricChange = vi.fn();
    setup({ bodyweightOnly: true, metric: 'sessionVolume', onMetricChange });

    expect(screen.getByRole('button', { name: 'Est. 1RM' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('chart-metric:est1rm')).toBeInTheDocument();
    expect(onMetricChange).not.toHaveBeenCalled();
  });

  it('keeps the real preference selected once it applies again', () => {
    setup({ bodyweightOnly: false, metric: 'sessionVolume' });
    expect(screen.getByRole('button', { name: 'Volume' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('chart-metric:sessionVolume')).toBeInTheDocument();
  });

  it('still writes the real preference when picking a metric from the shortened list', () => {
    const onMetricChange = vi.fn();
    setup({ bodyweightOnly: true, metric: 'est1rm', onMetricChange });
    fireEvent.click(screen.getByRole('button', { name: 'Reps' }));
    expect(onMetricChange).toHaveBeenCalledWith('totalReps');
  });
});

describe('ExerciseTrendSection history link', () => {
  const points = [
    { sessionId: 11, date: '2026-07-01', weightLb: 185, reps: 5, isPr: true, est1rmLb: 208 },
    { sessionId: 12, date: '2026-07-08', weightLb: 190, reps: 5, isPr: false, est1rmLb: 214 },
  ];

  // The per-session list of best sets that used to render here is gone: the chart above already
  // plots those sessions and marks their PRs, so it was the same data twice, and History owns the
  // question properly. Asserted as an absence because "we removed it" is otherwise only true until
  // somebody re-adds it.
  it('renders no per-session set list under the chart', () => {
    mockNavigate.mockClear();
    setup({ bodyweightOnly: false, points });
    expect(screen.queryByText('185 lb × 5')).not.toBeInTheDocument();
    expect(screen.queryByText('190 lb × 5')).not.toBeInTheDocument();
  });

  it('links into History filtered to the selected exercise', () => {
    mockNavigate.mockClear();
    setup({ bodyweightOnly: false, points });

    fireEvent.click(screen.getByRole('button', { name: 'View history for Pull-ups' }));
    expect(mockNavigate).toHaveBeenCalledWith('/app/history', {
      state: { historyExerciseFilter: { exerciseId: 1, exerciseName: 'Pull-ups' } },
    });
  });

  // trends.spec.ts's header warns that bare exercise-name lookups on this screen are already
  // ambiguous across the picker, History, PRs and this card's header. The link carries the name in
  // its accessible name only, so it adds no fifth copy to the visible text.
  it('keeps the exercise name out of the link’s visible text', () => {
    mockNavigate.mockClear();
    setup({ bodyweightOnly: false, points });
    expect(screen.getByRole('button', { name: 'View history for Pull-ups' })).toHaveTextContent(
      /^Exercise history/,
    );
  });
});
