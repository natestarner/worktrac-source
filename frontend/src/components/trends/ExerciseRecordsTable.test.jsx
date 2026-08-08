import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ExerciseRecordsTable from './ExerciseRecordsTable';

const loadedRecords = {
  repMaxes: [
    { repTarget: 1, weightLb: 225, reps: 1, date: '2026-07-01' },
    { repTarget: 3, weightLb: 205, reps: 3, date: '2026-06-20' },
    { repTarget: 5, weightLb: 185, reps: 8, date: '2026-07-14' },
    { repTarget: 8, weightLb: 185, reps: 8, date: '2026-07-14' },
    { repTarget: 10, weightLb: null, reps: null, date: null },
    { repTarget: 12, weightLb: null, reps: null, date: null },
  ],
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
  repMaxes: [
    { repTarget: 1, weightLb: 0, reps: 15, date: '2026-07-14' },
    { repTarget: 12, weightLb: 0, reps: 15, date: '2026-07-14' },
  ],
  heaviestWeight: { valueLb: 0, weightLb: 0, reps: 15, date: '2026-07-14' },
  bestSetVolume: { valueLb: 0, weightLb: 0, reps: 15, date: '2026-07-14' },
  bestSessionVolume: { valueLb: 0, weightLb: null, reps: null, date: '2026-07-14' },
  mostReps: { valueLb: 15, weightLb: 0, reps: 15, date: '2026-07-14' },
  totalSets: 30,
  totalReps: 285,
  totalVolumeLb: 0,
  bodyweightOnly: true,
};

// The same number legitimately shows up in several rows -- 185x8 sets both the 5+ and the 8+ rep
// max, and the 1+ rep max is by definition the heaviest-weight record. So every value assertion is
// scoped to its own row; a bare getByText would be a strict-mode collision, not a bug.
const rowText = (label) => screen.getByText(label).parentElement.textContent;

describe('ExerciseRecordsTable', () => {
  it('shows a skeleton while loading', () => {
    const { container } = render(<ExerciseRecordsTable records={null} loading defaultUnit="lb" />);
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.queryByText('Rep maxes')).not.toBeInTheDocument();
  });

  it('renders nothing for an exercise with no sets', () => {
    const { container } = render(
      <ExerciseRecordsTable records={{ ...loadedRecords, totalSets: 0 }} loading={false} defaultUnit="lb" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('labels rep maxes as "at least N" and shows the set that actually set each one', () => {
    render(<ExerciseRecordsTable records={loadedRecords} loading={false} defaultUnit="lb" />);

    expect(screen.getByText('5+ reps')).toBeInTheDocument();
    // The 5+ record was set by an 8-rep set -- the row has to say so, or "185 x 8" under "5+"
    // looks like a bug rather than the >= rule working.
    expect(rowText('5+ reps')).toMatch(/185 lb × 8/);
    expect(rowText('1+ reps')).toMatch(/225 lb × 1/);
    expect(rowText('3+ reps')).toMatch(/205 lb × 3/);
  });

  it('marks a rep target nothing has reached as "Not yet" rather than 0', () => {
    render(<ExerciseRecordsTable records={loadedRecords} loading={false} defaultUnit="lb" />);
    expect(screen.getAllByText('Not yet')).toHaveLength(2);
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

    // A rep-max column of zeros is worse than no column at all -- see ExerciseRecordsDto.
    expect(screen.queryByText('Rep maxes')).not.toBeInTheDocument();
    expect(screen.queryByText('Heaviest weight')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 lb/)).not.toBeInTheDocument();

    expect(screen.getByText('Records · bodyweight')).toBeInTheDocument();
    expect(screen.getByText('15 reps')).toBeInTheDocument();
    expect(screen.getByText('285 reps')).toBeInTheDocument();
  });

  it('converts every weight to the household unit', () => {
    render(<ExerciseRecordsTable records={loadedRecords} loading={false} defaultUnit="kg" />);
    expect(rowText('1+ reps')).toMatch(/102 kg × 1/);
    expect(rowText('Heaviest weight')).toMatch(/102 kg × 1/);
    expect(screen.queryByText(/lb/)).not.toBeInTheDocument();
  });
});
