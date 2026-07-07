import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrendsTab from './TrendsTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useTrendsOverview } from '../../hooks/useTrendsOverview';

// TrendsTab's own job is orchestration -- loading/empty states, the range toggle, and
// wiring the overview into SummaryCards -- so the heavier chart subcomponents (which
// render recharts, unreliable in jsdom without real layout) are mocked out here and
// exercised for real in TrendsTab manually / via the backend integration tests instead.
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useTrendsOverview', () => ({ useTrendsOverview: vi.fn() }));
vi.mock('./WeeklyFrequencyChart', () => ({ default: () => <div>weekly-frequency-chart</div> }));
vi.mock('./VolumeChart', () => ({ default: () => <div>volume-chart</div> }));
vi.mock('./CategoryBalanceChart', () => ({ default: () => <div>category-balance-chart</div> }));
vi.mock('./ExerciseTrendSection', () => ({ default: () => <div>exercise-trend-section</div> }));

const overviewWithActivity = {
  weeks: [
    { weekStart: '2026-06-22', workoutCount: 0, totalVolumeLb: 0 },
    { weekStart: '2026-06-29', workoutCount: 2, totalVolumeLb: 3000 },
  ],
  currentStreakWeeks: 1,
  workoutsThisWeek: 2,
  workoutsLastWeek: 0,
  volumeThisMonthLb: 3000,
  volumeLastMonthLb: 1500,
  categoryBreakdown: [{ category: 'Upper Push', setCount: 10, pct: 100 }],
};

describe('TrendsTab', () => {
  let setTrendsRange;

  beforeEach(() => {
    vi.clearAllMocks();
    setTrendsRange = vi.fn();
    useAppState.mockReturnValue({
      activePersonId: 7,
      trendsRangeWeeks: 12,
      setTrendsRange,
      trendsExerciseId: null,
      selectTrendsExercise: vi.fn(),
    });
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading state while the overview is being fetched', () => {
    useTrendsOverview.mockReturnValue({ overview: null, loading: true });
    render(<TrendsTab />);
    expect(screen.getByText(/loading trends/i)).toBeInTheDocument();
  });

  it('shows an empty state when the person has no workouts in range', () => {
    useTrendsOverview.mockReturnValue({
      overview: { ...overviewWithActivity, weeks: [{ weekStart: '2026-06-29', workoutCount: 0, totalVolumeLb: 0 }] },
      loading: false,
    });
    render(<TrendsTab />);
    expect(screen.getByText(/no workouts logged yet/i)).toBeInTheDocument();
  });

  it('renders summary cards and charts once there is activity in range', () => {
    useTrendsOverview.mockReturnValue({ overview: overviewWithActivity, loading: false });
    render(<TrendsTab />);

    expect(screen.getByText('1 week')).toBeInTheDocument();
    expect(screen.getByText('weekly-frequency-chart')).toBeInTheDocument();
    expect(screen.getByText('volume-chart')).toBeInTheDocument();
    expect(screen.getByText('category-balance-chart')).toBeInTheDocument();
    expect(screen.getByText('exercise-trend-section')).toBeInTheDocument();
  });

  it('lets the user change the range toggle', () => {
    useTrendsOverview.mockReturnValue({ overview: overviewWithActivity, loading: false });
    render(<TrendsTab />);

    fireEvent.click(screen.getByText('4wk'));
    expect(setTrendsRange).toHaveBeenCalledWith(4);
  });
});
