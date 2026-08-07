import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useTrendsOverview } from '../../hooks/useTrendsOverview';
import RangeToggle, { rangeEmptyLabel } from './RangeToggle';
import SummaryCards from './SummaryCards';
import WeeklyFrequencyChart from './WeeklyFrequencyChart';
import WeeklyMetricChart from './WeeklyMetricChart';
import ConsistencyHeatmap from './ConsistencyHeatmap';
import RecentPrsCard from './RecentPrsCard';
import ExerciseTrendSection from './ExerciseTrendSection';
import Skeleton from '../shared/Skeleton';
import RefreshingPill from '../shared/RefreshingPill';
import OfflineDataNotice from '../shared/OfflineDataNotice';

const cardStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 18px' };

// One placeholder shape per real chart component below (ConsistencyHeatmap, WeeklyFrequencyChart,
// WeeklyMetricChart, ExerciseTrendChart) -- each mirrors that component's own
// padding/label/body dimensions so nothing resizes when real data replaces it.
function BarChartSkeleton() {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 12px 8px' }}>
      <Skeleton width={130} height={13} style={{ margin: '0 8px 8px' }} />
      <Skeleton width="100%" height={160} radius={8} />
    </div>
  );
}

function HeatmapSkeleton() {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16 }}>
      <Skeleton width={170} height={13} style={{ marginBottom: 12 }} />
      {/* 7 rows of 10px cells + 3px gaps + the month-label strip = 107px. */}
      <Skeleton width="100%" height={107} radius={8} />
    </div>
  );
}

function TrendsSkeleton() {
  return (
    <div data-testid="trends-skeleton">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Skeleton width={160} height={34} radius={10} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
        <div style={cardStyle}>
          <Skeleton width={50} height={11} style={{ marginBottom: 8 }} />
          <Skeleton width={90} height={20} />
        </div>
        <div style={cardStyle}>
          <Skeleton width={70} height={11} style={{ marginBottom: 8 }} />
          <Skeleton width={100} height={20} style={{ marginBottom: 2 }} />
          <Skeleton width={120} height={13} />
        </div>
        <div style={cardStyle}>
          <Skeleton width={110} height={11} style={{ marginBottom: 8 }} />
          <Skeleton width={130} height={20} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
        <HeatmapSkeleton />
        <BarChartSkeleton />
        <BarChartSkeleton />
      </div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16 }}>
        <Skeleton width={140} height={13} style={{ marginBottom: 12 }} />
        <Skeleton width="100%" height={42} radius={12} style={{ marginBottom: 12 }} />
        <Skeleton width={260} height={34} radius={10} style={{ marginBottom: 12 }} />
        <Skeleton width="100%" height={200} radius={8} />
      </div>
    </div>
  );
}

export default function TrendsTab() {
  const {
    activePersonId,
    trendsRangeWeeks,
    setTrendsRange,
    trendsExerciseId,
    selectTrendsExercise,
    trendsWeeklyMetric,
    setTrendsWeeklyMetric,
    trendsExerciseMetric,
    setTrendsExerciseMetric,
  } = useAppState();
  const { account } = useAuth();
  const defaultUnit = account?.defaultUnit || 'lb';

  const { overview, loading, isFetching, updatedAt } = useTrendsOverview(activePersonId, trendsRangeWeeks);

  if (loading || !overview) {
    return <TrendsSkeleton />;
  }

  // Two genuinely different empty states. `weeks` only describes the SELECTED range, so keying the
  // onboarding copy off it told someone with years of history that they'd never logged a workout
  // the moment they clicked 4wk. hasAnyHistory is range-independent and separates the two.
  const hasActivityInRange = overview.weeks.some((w) => w.workoutCount > 0);
  if (!hasActivityInRange) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <RangeToggle weeks={trendsRangeWeeks} onChange={setTrendsRange} />
        </div>
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-faint)', fontSize: 15 }}>
          {overview.hasAnyHistory
            ? `No workouts in the ${rangeEmptyLabel(trendsRangeWeeks)} — try a wider range.`
            : 'No workouts logged yet — trends will show up here once a few sessions are in the books.'}
        </div>
      </div>
    );
  }

  return (
    <div>
      <RefreshingPill show={isFetching && !loading} />
      <OfflineDataNotice updatedAt={updatedAt} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <RangeToggle weeks={trendsRangeWeeks} onChange={setTrendsRange} />
      </div>

      <SummaryCards overview={overview} defaultUnit={defaultUnit} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
        <ConsistencyHeatmap workoutDays={overview.workoutDays} />
        <WeeklyFrequencyChart weeks={overview.weeks} />
        <WeeklyMetricChart
          weeks={overview.weeks}
          metric={trendsWeeklyMetric}
          onMetricChange={setTrendsWeeklyMetric}
          defaultUnit={defaultUnit}
        />
        <RecentPrsCard
          recentPrs={overview.recentPrs}
          defaultUnit={defaultUnit}
          onSelectExercise={selectTrendsExercise}
        />
      </div>

      <ExerciseTrendSection
        personId={activePersonId}
        exerciseId={trendsExerciseId}
        onSelectExercise={selectTrendsExercise}
        weeks={trendsRangeWeeks}
        metric={trendsExerciseMetric}
        onMetricChange={setTrendsExerciseMetric}
        defaultUnit={defaultUnit}
      />
    </div>
  );
}
