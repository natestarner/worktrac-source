import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrendsTab from './TrendsTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useTrendsOverview } from '../../hooks/useTrendsOverview';

// TrendsTab's own job is orchestration -- loading/empty states, the range toggle, and
// wiring the overview into SummaryCards -- so the heavier chart subcomponents (which
// render recharts, unreliable in jsdom without real layout) are mocked out here and
// exercised for real in TrendsTab manually / via the backend integration tests instead.
// ConsistencyHeatmap is deliberately NOT mocked-by-necessity: it's plain DOM and has its own
// real test file, so it's stubbed here only to keep this file about orchestration.
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useTrendsOverview', () => ({ useTrendsOverview: vi.fn() }));
vi.mock('./WeeklyFrequencyChart', () => ({ default: () => <div>weekly-frequency-chart</div> }));
vi.mock('./WeeklyMetricChart', () => ({ default: () => <div>weekly-metric-chart</div> }));
vi.mock('./ConsistencyHeatmap', () => ({ default: () => <div>consistency-heatmap</div> }));
vi.mock('./ExerciseTrendSection', () => ({ default: () => <div>exercise-trend-section</div> }));

const overviewWithActivity = {
  weeks: [
    { weekStart: '2026-06-22', workoutCount: 0, totalVolumeLb: 0, totalSets: 0, totalReps: 0 },
    { weekStart: '2026-06-29', workoutCount: 2, totalVolumeLb: 3000, totalSets: 18, totalReps: 140 },
  ],
  currentStreakWeeks: 1,
  workoutsThisWeek: 2,
  workoutsLastWeek: 0,
  volumeThisMonthLb: 3000,
  volumeLastMonthLb: 1500,
  workoutDays: [{ date: '2026-06-29', sessionCount: 1, setCount: 9 }],
  hasAnyHistory: true,
};

const emptyRange = (hasAnyHistory) => ({
  ...overviewWithActivity,
  weeks: [{ weekStart: '2026-06-29', workoutCount: 0, totalVolumeLb: 0, totalSets: 0, totalReps: 0 }],
  hasAnyHistory,
});

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
      trendsWeeklyMetric: 'volume',
      setTrendsWeeklyMetric: vi.fn(),
      trendsExerciseMetric: 'est1rm',
      setTrendsExerciseMetric: vi.fn(),
    });
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a skeleton while the overview is being fetched', () => {
    useTrendsOverview.mockReturnValue({ overview: null, loading: true });
    render(<TrendsTab />);
    expect(screen.getByTestId('trends-skeleton')).toBeInTheDocument();
  });

  it('shows the onboarding empty state only for a person who has never logged anything', () => {
    useTrendsOverview.mockReturnValue({ overview: emptyRange(false), loading: false });
    render(<TrendsTab />);
    expect(screen.getByText(/no workouts logged yet/i)).toBeInTheDocument();
  });

  it('tells a lapsed person the RANGE is empty, not that they have never trained', () => {
    // The regression this guards: keying the onboarding copy off the selected range alone told
    // someone with years of history "No workouts logged yet" the moment they clicked 4wk.
    useTrendsOverview.mockReturnValue({ overview: emptyRange(true), loading: false });
    render(<TrendsTab />);

    expect(screen.getByText(/no workouts in the last 12 weeks/i)).toBeInTheDocument();
    expect(screen.queryByText(/no workouts logged yet/i)).not.toBeInTheDocument();
  });

  it('keeps the range toggle usable on the empty-range state so the person can widen it', () => {
    useTrendsOverview.mockReturnValue({ overview: emptyRange(true), loading: false });
    render(<TrendsTab />);

    fireEvent.click(screen.getByText('All'));
    expect(setTrendsRange).toHaveBeenCalledWith(260);
  });

  it('names the actual selected range in the empty-range copy, including "All"', () => {
    useAppState.mockReturnValue({
      activePersonId: 7,
      trendsRangeWeeks: 260,
      setTrendsRange,
      trendsExerciseId: null,
      selectTrendsExercise: vi.fn(),
      trendsWeeklyMetric: 'volume',
      setTrendsWeeklyMetric: vi.fn(),
      trendsExerciseMetric: 'est1rm',
      setTrendsExerciseMetric: vi.fn(),
    });
    useTrendsOverview.mockReturnValue({ overview: emptyRange(true), loading: false });
    render(<TrendsTab />);

    // "All" is 5 years, not 12 weeks -- a hardcoded label got this wrong.
    expect(screen.getByText(/no workouts in the last 5 years/i)).toBeInTheDocument();
  });

  it('renders summary cards and every chart section once there is activity in range', () => {
    useTrendsOverview.mockReturnValue({ overview: overviewWithActivity, loading: false });
    render(<TrendsTab />);

    expect(screen.getByText('1 week')).toBeInTheDocument();
    expect(screen.getByText('consistency-heatmap')).toBeInTheDocument();
    expect(screen.getByText('weekly-frequency-chart')).toBeInTheDocument();
    expect(screen.getByText('weekly-metric-chart')).toBeInTheDocument();
    expect(screen.getByText('exercise-trend-section')).toBeInTheDocument();
  });

  it('lets the user change the range toggle', () => {
    useTrendsOverview.mockReturnValue({ overview: overviewWithActivity, loading: false });
    render(<TrendsTab />);

    fireEvent.click(screen.getByText('4wk'));
    expect(setTrendsRange).toHaveBeenCalledWith(4);
  });

  it('shows the offline data notice only while offline', () => {
    onlineManager.setOnline(true);
    useTrendsOverview.mockReturnValue({
      overview: overviewWithActivity,
      loading: false,
      updatedAt: new Date('2026-07-22T15:00:00').getTime(),
    });
    render(<TrendsTab />);
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByText(/Offline.*data as of/)).toBeInTheDocument();
    onlineManager.setOnline(true);
  });
});
