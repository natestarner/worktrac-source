import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ExerciseRecordsTable from './ExerciseRecordsTable';

const loadedRecords = {
  // 185 x 8 estimates to 234.3, which beats the 225 x 1 single -- the whole reason this row is
  // not the same thing as heaviestWeight.
  bestEst1rm: { valueLb: 234.3, weightLb: 185, reps: 8, date: '2026-07-14' },
  heaviestWeight: { valueLb: 225, weightLb: 225, reps: 1, date: '2026-07-01' },
  bestSetVolume: { valueLb: 1480, weightLb: 185, reps: 8, date: '2026-07-14' },
  bestSessionVolume: { valueLb: 4200, weightLb: null, reps: null, date: '2026-07-14' },
  mostReps: { valueLb: 12, weightLb: 135, reps: 12, date: '2026-05-02' },
  totalSets: 96,
  totalReps: 512,
  totalVolumeLb: 74210,
  bodyweightOnly: false,
};

const bodyweightRecords = {
  bestEst1rm: null, // the backend sends null rather than a rep count dressed up as pounds
  heaviestWeight: { valueLb: 0, weightLb: 0, reps: 15, date: '2026-07-14' },
  bestSetVolume: { valueLb: 0, weightLb: 0, reps: 15, date: '2026-07-14' },
  bestSessionVolume: { valueLb: 0, weightLb: null, reps: null, date: '2026-07-14' },
  mostReps: { valueLb: 15, weightLb: 0, reps: 15, date: '2026-07-14' },
  totalSets: 30,
  totalReps: 285,
  totalVolumeLb: 0,
  bodyweightOnly: true,
};

// The same number legitimately shows up in several rows, so every value assertion is scoped to its
// own row; a bare getByText would be a strict-mode collision, not a bug.
const rowText = (label) => screen.getByText(label).parentElement.textContent;

describe('ExerciseRecordsTable', () => {
  it('shows a skeleton while loading', () => {
    const { container } = render(<ExerciseRecordsTable records={null} loading defaultUnit="lb" />);
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.queryByText('All-time bests')).not.toBeInTheDocument();
  });

  it('renders nothing for an exercise with no sets', () => {
    const { container } = render(
      <ExerciseRecordsTable records={{ ...loadedRecords, totalSets: 0 }} loading={false} defaultUnit="lb" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('reports the best est. 1RM separately from the heaviest weight, since they disagree', () => {
    render(<ExerciseRecordsTable records={loadedRecords} loading={false} defaultUnit="lb" />);

    // 185x8 estimates higher than the 225x1 single. Without the qualifier this row reads as a
    // number you never actually lifted, so it has to name the set behind it.
    expect(rowText('Best est. 1RM')).toMatch(/234\.3 lb/);
    expect(rowText('Best est. 1RM')).toMatch(/185 lb × 8/);
    expect(rowText('Heaviest weight')).toMatch(/225 lb × 1/);
  });

  it('omits the est. 1RM row when the backend has no loaded set to estimate from', () => {
    render(
      <ExerciseRecordsTable
        records={{ ...loadedRecords, bestEst1rm: null }}
        loading={false}
        defaultUnit="lb"
      />,
    );
    expect(screen.queryByText('Best est. 1RM')).not.toBeInTheDocument();
    expect(screen.getByText('Heaviest weight')).toBeInTheDocument();
  });

  it('lists the all-time bests and lifetime totals', () => {
    render(<ExerciseRecordsTable records={loadedRecords} loading={false} defaultUnit="lb" />);

    expect(screen.getByText('Heaviest weight')).toBeInTheDocument();
    expect(screen.getByText(/1480 lb/)).toBeInTheDocument();
    expect(screen.getByText(/4200 lb/)).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
    expect(screen.getByText(/74210 lb/)).toBeInTheDocument();
  });

  it('drops every weight-based record for a bodyweight-only lift', () => {
    render(<ExerciseRecordsTable records={bodyweightRecords} loading={false} defaultUnit="lb" />);

    // A column of zeros is worse than no column at all -- see ExerciseRecordsDto.
    expect(screen.queryByText('All-time bests')).not.toBeInTheDocument();
    expect(screen.queryByText('Best est. 1RM')).not.toBeInTheDocument();
    expect(screen.queryByText('Heaviest weight')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 lb/)).not.toBeInTheDocument();

    expect(screen.getByText('Records · bodyweight')).toBeInTheDocument();
    expect(screen.getByText('15 reps')).toBeInTheDocument();
    expect(screen.getByText('285 reps')).toBeInTheDocument();
  });

  it('converts every weight to the household unit', () => {
    render(<ExerciseRecordsTable records={loadedRecords} loading={false} defaultUnit="kg" />);
    expect(rowText('Heaviest weight')).toMatch(/102 kg × 1/);
    // Both halves of the est. 1RM row convert -- the estimate and the set it came from.
    expect(rowText('Best est. 1RM')).toMatch(/106\.5 kg/);
    expect(rowText('Best est. 1RM')).toMatch(/84 kg × 8/);
    expect(screen.queryByText(/lb/)).not.toBeInTheDocument();
  });
});
