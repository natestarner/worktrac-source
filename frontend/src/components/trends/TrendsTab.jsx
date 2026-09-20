import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useTrendsOverview } from '../../hooks/useTrendsOverview';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';
import RangeToggle, { rangeEmptyLabel } from './RangeToggle';
import SummaryCards from './SummaryCards';
import WeeklyMetricChart from './WeeklyMetricChart';
import ConsistencyHeatmap from './ConsistencyHeatmap';
import ExerciseTrendSection from './ExerciseTrendSection';
import Skeleton from '../shared/Skeleton';
import RefreshIndicator from '../shared/RefreshIndicator';
import OfflineDataNotice from '../shared/OfflineDataNotice';
import EmptyState from '../shared/EmptyState';
import HistoryWindowNotice from '../shared/HistoryWindowNotice';
import { IconTrendingUp } from '../shared/icons';
import { rangeReachesPastWindow, windowLabel } from '../shared/historyWindowCopy';
import Card from '../shared/Card';


// One placeholder shape per real chart component below (ConsistencyHeatmap, WeeklyMetricChart,
// ExerciseTrendChart) -- each mirrors that component's own padding/label/body dimensions so
// nothing resizes when real data replaces it.
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
    <Card size="dense">
      <Skeleton width={170} height={13} style={{ marginBottom: 12 }} />
      {/* 7 rows of 10px cells + 3px gaps + the month-label strip = 107px. */}
      <Skeleton width="100%" height={107} radius={8} />
    </Card>
  );
}

function TrendsSkeleton() {
  return (
    <div data-testid="trends-skeleton">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Skeleton width={160} height={34} radius={10} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
        <Card size="dense">
          <Skeleton width={50} height={11} style={{ marginBottom: 8 }} />
          <Skeleton width={90} height={20} />
        </Card>
        <Card size="dense">
          <Skeleton width={70} height={11} style={{ marginBottom: 8 }} />
          <Skeleton width={100} height={20} style={{ marginBottom: 2 }} />
          <Skeleton width={120} height={13} />
        </Card>
        <Card size="dense">
          <Skeleton width={110} height={11} style={{ marginBottom: 8 }} />
          <Skeleton width={130} height={20} />
        </Card>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
        <HeatmapSkeleton />
        <BarChartSkeleton />
      </div>
      <Card size="dense">
        <Skeleton width={140} height={13} style={{ marginBottom: 12 }} />
        <Skeleton width="100%" height={42} radius={12} style={{ marginBottom: 12 }} />
        <Skeleton width={260} height={34} radius={10} style={{ marginBottom: 12 }} />
        <Skeleton width="100%" height={200} radius={8} />
      </Card>
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
  const location = useLocation();
  const navigate = useNavigate();
  const defaultUnit = account?.defaultUnit || 'lb';

  // Deep link from a PR row's "View progress" (see PRsTab.jsx). Same router-state mechanism as
  // History's `historyExerciseFilter`, consumed once and scrubbed for the same reason: React Router
  // persists location.state into window.history.state, so without scrubbing it would reapply on
  // reload and on Back -- and swUpdate's tryForceUpdate can force a reload on an ordinary tab
  // switch.
  //
  // Read during RENDER, not in an effect, and handed straight to ExerciseTrendSection below. That
  // ordering is load-bearing: effects run child-first, so ExerciseTrendSection's
  // default-to-the-first-exercise effect would otherwise fire before this component's consume
  // effect and briefly select the wrong exercise. Giving it a truthy exerciseId on the very first
  // render makes that effect a no-op instead.
  const [seed, setSeed] = useState(() => location.state?.trendsExerciseFocus?.exerciseId ?? null);
  const [scrollPending, setScrollPending] = useState(() => !!location.state?.trendsExerciseFocus);

  useEffect(() => {
    if (!location.state?.trendsExerciseFocus) return;
    // Persisting the arrival is deliberate, and this is the one place it differs from History's
    // filter, which is ephemeral by design. The Trends exercise selection is a "where I left off"
    // value; arriving here from a PR row IS leaving off on that exercise, so it should still be
    // selected next time. After this dispatch the stored value equals the seed, which is what
    // makes clearing the local copy below seamless rather than a flicker.
    selectTrendsExercise(location.state.trendsExerciseFocus.exerciseId);
    navigate(location.pathname, { replace: true, state: null }); // scrub the history entry
    setSeed(null); // scrub our own copy
    // One-shot consume-on-mount, not a reactive sync against location.state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A deep link has to SCROLL, and nothing does that for free -- the same lesson the Handbook's
  // hash links learned (.claude/rules/user-facing-help.md). A callback ref rather than a mount
  // effect, following BillingTab's ?intent=pro anchor: this component returns a skeleton early
  // while the overview loads, so the anchor does not exist on the first render and a mount effect
  // would look for it once and never retry.
  const scrollPendingRef = useRef(scrollPending);
  scrollPendingRef.current = scrollPending;
  const exerciseSectionRef = useCallback((node) => {
    if (!node || !scrollPendingRef.current) return;
    scrollPendingRef.current = false;
    setScrollPending(false);
    // jsdom computes no layout and defines no scrollIntoView -- degrade to "no scroll" rather
    // than throwing. Only the e2e scrollY assertion can actually prove this one.
    node.scrollIntoView?.({ block: 'start' });
  }, []);

  const { overview, loading, isFetching, isPaused, isError, updatedAt } = useTrendsOverview(
    activePersonId,
    trendsRangeWeeks,
  );
  const { historyWindow } = useHistoryWindow(activePersonId);

  const hiddenFromView = historyWindow?.hiddenSessions ?? 0;

  // The range toggle is the control this notice qualifies, so when the selected range reaches back
  // past the window, say so in those terms -- "All" promising five years while the charts stop at
  // 90 days is the sharpest version of the problem. Inside the window (4wk, 12wk) the charts for
  // that range really are complete, so the lead would be false and is left off.
  //
  // The notice still shows on those ranges, because the consistency grid is a FIXED trailing window
  // that ignores the toggle entirely (see .claude/rules/trends.md) -- so it is clipped on every
  // range, not just the wide one.
  const trendsLead = rangeReachesPastWindow(trendsRangeWeeks, historyWindow?.windowStart)
    ? `This range shows ${windowLabel(historyWindow?.windowStart)} on Free.`
    : undefined;
  const windowNotice = (
    <HistoryWindowNotice plan={account?.plan} historyWindow={historyWindow} lead={trendsLead} />
  );

  // Nothing cached AND nothing coming. Trends is the one tab deliberately left out of
  // offlineCacheWarm (warming three keys per person across every person is a costly fan-out, and
  // unlike Log/History/PRs these charts are not what you reach for mid-workout), so a device that
  // has never opened Trends online has no fallback data at all.
  //
  // Both branches present identically to the old code: while PAUSED, isLoading is false and data is
  // undefined; on a hard ERROR with no cache, likewise. `loading || !overview` therefore latched
  // TrendsSkeleton forever -- a spinner over a request that will never succeed, which is precisely
  // what resilience.md forbids. Saying so is the only honest option left; there is nothing to show
  // and nothing to queue. Registered in .claude/rules/resilience.md.
  if (!overview && (isPaused || isError)) {
    return (
      <EmptyState
        icon={IconTrendingUp}
        title="Trends need a connection"
        body="These charts are built on the server and aren’t saved for offline use. Your Log, History and PRs tabs still work from here."
      />
    );
  }

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
        {/* Three cases now, not two. "Try a wider range" is useless advice to someone on Free whose
            wider ranges are exactly what the window is clipping -- widening the range cannot reach
            what it is hiding, so saying so would send them in a circle. */}
        {hiddenFromView > 0 ? (
          <EmptyState
            icon={IconTrendingUp}
            title={`No workouts in the ${rangeEmptyLabel(trendsRangeWeeks)}`}
            body="Earlier training is part of your full history."
            action={windowNotice}
          />
        ) : (
          <EmptyState
            icon={IconTrendingUp}
            title={overview.hasAnyHistory ? `No workouts in the ${rangeEmptyLabel(trendsRangeWeeks)}` : 'No workouts logged yet'}
            body={
              overview.hasAnyHistory
                ? 'Try a wider range.'
                : 'Trends will show up here once a few sessions are in the books.'
            }
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <RefreshIndicator show={isFetching && !loading} />
      <OfflineDataNotice updatedAt={updatedAt} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <RangeToggle weeks={trendsRangeWeeks} onChange={setTrendsRange} />
      </div>

      {/* Directly under the toggle and above the cards: the toggle is the control making the
          promise, and the cards are the numbers it qualifies. */}
      {windowNotice}

      <SummaryCards overview={overview} defaultUnit={defaultUnit} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
        <ConsistencyHeatmap workoutDays={overview.workoutDays} />
        <WeeklyMetricChart
          weeks={overview.weeks}
          metric={trendsWeeklyMetric}
          onMetricChange={setTrendsWeeklyMetric}
          defaultUnit={defaultUnit}
        />
      </div>

      <div ref={exerciseSectionRef} className="trends-exercise-anchor">
        <ExerciseTrendSection
          personId={activePersonId}
          exerciseId={seed ?? trendsExerciseId}
          onSelectExercise={selectTrendsExercise}
          weeks={trendsRangeWeeks}
          metric={trendsExerciseMetric}
          onMetricChange={setTrendsExerciseMetric}
          defaultUnit={defaultUnit}
        />
      </div>
    </div>
  );
}
