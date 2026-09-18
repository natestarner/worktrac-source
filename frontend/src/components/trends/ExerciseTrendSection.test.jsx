import { render, screen, fireEvent } from '@testing-library/react';
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

const loggedExercises = [
  { exerciseId: 1, exerciseName: 'Pull-ups' },
  { exerciseId: 2, exerciseName: 'Bench Press' },
];

function setup({ bodyweightOnly, metric = 'est1rm', onMetricChange = vi.fn() } = {}) {
  usePrs.mockReturnValue({ prs: loggedExercises });
  useExerciseTrend.mockReturnValue({ points: [], loading: false });
  useExerciseRecords.mockReturnValue({ records: { bodyweightOnly }, loading: false });

  render(
    <ExerciseTrendSection
      personId={7}
      exerciseId={1}
      onSelectExercise={vi.fn()}
      weeks={12}
      metric={metric}
      onMetricChange={onMetricChange}
      defaultUnit="lb"
    />,
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
