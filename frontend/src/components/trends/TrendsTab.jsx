import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useTrendsOverview } from '../../hooks/useTrendsOverview';
import RangeToggle from './RangeToggle';
import SummaryCards from './SummaryCards';
import WeeklyFrequencyChart from './WeeklyFrequencyChart';
import VolumeChart from './VolumeChart';
import CategoryBalanceChart from './CategoryBalanceChart';
import ExerciseTrendSection from './ExerciseTrendSection';

export default function TrendsTab() {
  const { activePersonId, trendsRangeWeeks, setTrendsRange, trendsExerciseId, selectTrendsExercise } = useAppState();
  const { account } = useAuth();
  const defaultUnit = account?.defaultUnit || 'lb';

  const { overview, loading } = useTrendsOverview(activePersonId, trendsRangeWeeks);

  if (loading || !overview) {
    return <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-faint)', fontSize: 15 }}>Loading trends&hellip;</div>;
  }

  const hasAnyActivity = overview.weeks.some((w) => w.workoutCount > 0);
  if (!hasAnyActivity) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-faint)', fontSize: 15 }}>
        No workouts logged yet &mdash; trends will show up here once a few sessions are in the books.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <RangeToggle weeks={trendsRangeWeeks} onChange={setTrendsRange} />
      </div>

      <SummaryCards overview={overview} defaultUnit={defaultUnit} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
        <WeeklyFrequencyChart weeks={overview.weeks} />
        <VolumeChart weeks={overview.weeks} defaultUnit={defaultUnit} />
        <CategoryBalanceChart breakdown={overview.categoryBreakdown} />
      </div>

      <ExerciseTrendSection
        personId={activePersonId}
        exerciseId={trendsExerciseId}
        onSelectExercise={selectTrendsExercise}
        weeks={trendsRangeWeeks}
        defaultUnit={defaultUnit}
      />
    </div>
  );
}
