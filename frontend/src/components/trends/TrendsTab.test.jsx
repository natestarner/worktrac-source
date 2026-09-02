import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// This tab's data hooks are all mocked, but OfflineDataNotice reads the durable outbox count
// straight off the mutation cache, so the tree still needs a real QueryClient around it.
import { renderWithQuery } from '../../test/queryWrapper';
import TrendsTab from './TrendsTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useTrendsOverview } from '../../hooks/useTrendsOverview';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';

// TrendsTab's own job is orchestration -- loading/empty states, the range toggle, and
// wiring the overview into SummaryCards -- so the heavier chart subcomponents (which
// render recharts, unreliable in jsdom without real layout) are mocked out here and
// exercised for real in TrendsTab manually / via the backend integration tests instead.
// ConsistencyHeatmap is deliberately NOT mocked-by-necessity: it's plain DOM and has its own
// real test file, so it's stubbed here only to keep this file about orchestration.
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useTrendsOverview', () => ({ useTrendsOverview: vi.fn() }));
vi.mock('../../hooks/useHistoryWindow', () => ({ useHistoryWindow: vi.fn() }));
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
    useHistoryWindow.mockReturnValue({ historyWindow: null });
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
    renderWithQuery(<TrendsTab />);
    expect(screen.getByTestId('trends-skeleton')).toBeInTheDocument();
  });

  it('shows the onboarding empty state only for a person who has never logged anything', () => {
    useTrendsOverview.mockReturnValue({ overview: emptyRange(false), loading: false });
    renderWithQuery(<TrendsTab />);
    expect(screen.getByText(/no workouts logged yet/i)).toBeInTheDocument();
  });

  it('tells a lapsed person the RANGE is empty, not that they have never trained', () => {
    // The regression this guards: keying the onboarding copy off the selected range alone told
    // someone with years of history "No workouts logged yet" the moment they clicked 4wk.
    useTrendsOverview.mockReturnValue({ overview: emptyRange(true), loading: false });
    renderWithQuery(<TrendsTab />);

    expect(screen.getByText(/no workouts in the last 12 weeks/i)).toBeInTheDocument();
    expect(screen.queryByText(/no workouts logged yet/i)).not.toBeInTheDocument();
  });

  it('keeps the range toggle usable on the empty-range state so the person can widen it', () => {
    useTrendsOverview.mockReturnValue({ overview: emptyRange(true), loading: false });
    renderWithQuery(<TrendsTab />);

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
    renderWithQuery(<TrendsTab />);

    // "All" is 5 years, not 12 weeks -- a hardcoded label got this wrong.
    expect(screen.getByText(/no workouts in the last 5 years/i)).toBeInTheDocument();
  });

  it('renders summary cards and every chart section once there is activity in range', () => {
    useTrendsOverview.mockReturnValue({ overview: overviewWithActivity, loading: false });
    renderWithQuery(<TrendsTab />);

    expect(screen.getByText('1 week')).toBeInTheDocument();
    expect(screen.getByText('consistency-heatmap')).toBeInTheDocument();
    expect(screen.getByText('weekly-frequency-chart')).toBeInTheDocument();
    expect(screen.getByText('weekly-metric-chart')).toBeInTheDocument();
    expect(screen.getByText('exercise-trend-section')).toBeInTheDocument();
  });

  it('lets the user change the range toggle', () => {
    useTrendsOverview.mockReturnValue({ overview: overviewWithActivity, loading: false });
    renderWithQuery(<TrendsTab />);

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
    renderWithQuery(<TrendsTab />);
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByText(/Offline.*data as of/)).toBeInTheDocument();
    onlineManager.setOnline(true);
  });
});

// TrendsTab renders no router links until the window notice appears, which is why the rest of this
// file needs no MemoryRouter and this block does.
describe('TrendsTab and the Free-tier window', () => {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const clipped = { windowStart: ninetyDaysAgo, hiddenSessions: 21, earliestHiddenAt: '2025-01-02T10:00:00Z' };

  function renderTrends() {
    return renderWithQuery(
      <MemoryRouter>
        <TrendsTab />
      </MemoryRouter>,
    );
  }

  function mockAppState(trendsRangeWeeks) {
    useAppState.mockReturnValue({
      activePersonId: 7,
      trendsRangeWeeks,
      setTrendsRange: vi.fn(),
      trendsExerciseId: null,
      selectTrendsExercise: vi.fn(),
      trendsWeeklyMetric: 'volume',
      setTrendsWeeklyMetric: vi.fn(),
      trendsExerciseMetric: 'est1rm',
      setTrendsExerciseMetric: vi.fn(),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb', plan: 'FREE' } });
    useHistoryWindow.mockReturnValue({ historyWindow: clipped });
  });

  it('qualifies the charts on a populated screen', () => {
    mockAppState(12);
    useTrendsOverview.mockReturnValue({ overview: overviewWithActivity, loading: false });

    renderTrends();

    expect(screen.getByText(/Your full history has 21 more workouts/)).toBeInTheDocument();
  });

  // 12 weeks is 84 days and fits inside a 90-day window, so the charts for THAT range are complete
  // and a "this range is clipped" lead would be false. The notice still shows, because the
  // consistency grid ignores the range toggle and is clipped on every range.
  it('does not claim a range is clipped when that range fits inside the window', () => {
    mockAppState(12);
    useTrendsOverview.mockReturnValue({ overview: overviewWithActivity, loading: false });

    renderTrends();

    expect(screen.queryByText(/This range shows/)).not.toBeInTheDocument();
  });

  // "All" promises five years while the charts stop at 90 days. That is the sharpest version of the
  // problem and the one place the range itself is worth naming.
  it('names the range when the toggle promises more than the window can show', () => {
    mockAppState(260);
    useTrendsOverview.mockReturnValue({ overview: overviewWithActivity, loading: false });

    renderTrends();

    expect(screen.getByText(/This range shows the last 90 days on Free/)).toBeInTheDocument();
  });

  // "Try a wider range" is a loop for someone on Free: widening the range is exactly what the
  // window is clipping, so it cannot reach what it is hiding.
  it('does not send a clipped household to widen a range that cannot help', () => {
    mockAppState(4);
    useTrendsOverview.mockReturnValue({ overview: emptyRange(true), loading: false });

    renderTrends();

    expect(screen.queryByText(/Try a wider range/)).not.toBeInTheDocument();
    expect(screen.getByText(/Earlier training is part of your full history/)).toBeInTheDocument();
  });

  it('keeps the original range-empty copy when nothing is hidden', () => {
    mockAppState(4);
    useHistoryWindow.mockReturnValue({
      historyWindow: { windowStart: ninetyDaysAgo, hiddenSessions: 0, earliestHiddenAt: null },
    });
    useTrendsOverview.mockReturnValue({ overview: emptyRange(true), loading: false });

    renderTrends();

    expect(screen.getByText(/Try a wider range/)).toBeInTheDocument();
  });
});
