import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrs } from '../../hooks/usePrs';
import { useExerciseTrend } from '../../hooks/useExerciseTrend';
import { useExerciseRecords } from '../../hooks/useExerciseRecords';
import ExerciseTrendChart from './ExerciseTrendChart';
import ExerciseRecordsTable from './ExerciseRecordsTable';
import SegmentedToggle from '../shared/SegmentedToggle';
import ChartHelp from '../shared/ChartHelp';
import { visibleMetricOptions, metricSpec } from './exerciseMetrics';
import { exerciseTrendHelp } from './chartHelp';
import Skeleton from '../shared/Skeleton';
import Card from '../shared/Card';

// 16px avoids iOS Safari's input-zoom -- see ExercisePicker.jsx's fontSize comment.
const selectStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 16,
  fontWeight: 600,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  marginBottom: 12,
};

// A ghost-button link, not <Button variant="ghost">: it sits inside a card that already has its
// own visual weight, and at --text-sm it reads as the tail of the card rather than as a control
// competing with the metric switcher above it.
const historyLinkStyle = {
  background: 'none',
  border: 'none',
  padding: 'var(--space-2) 0',
  font: 'inherit',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  color: 'var(--color-accent-text)',
  cursor: 'pointer',
};

export default function ExerciseTrendSection({
  personId,
  exerciseId,
  onSelectExercise,
  weeks,
  metric,
  onMetricChange,
  defaultUnit,
}) {
  const navigate = useNavigate();
  // Same cached PR list the PR board reads (queryKeys.prs), so the dropdown can't diverge from it.
  const { prs: loggedExercises } = usePrs(personId);

  // Default the dropdown to the first exercise once the list has loaded and none is selected yet.
  useEffect(() => {
    if (!exerciseId && loggedExercises.length > 0) {
      onSelectExercise(loggedExercises[0].exerciseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedExercises, exerciseId]);

  const { points, loading } = useExerciseTrend(personId, exerciseId, weeks);
  // Range-free, so flipping 4wk/12wk/All above doesn't refetch this.
  const { records, loading: recordsLoading } = useExerciseRecords(personId, exerciseId);

  if (loggedExercises.length === 0) {
    return null;
  }

  // Top weight/Volume/Best set are meaningless -- flat zero lines -- for an exercise whose whole
  // history is bodyweight (see visibleMetricOptions). While records are still loading, show the
  // unfiltered list rather than gating the switcher on a second loading flag; this query is
  // range-free and normally cache-warm, so it's a brief state, not a lasting one.
  const options = visibleMetricOptions(recordsLoading ? false : records?.bodyweightOnly);
  // The persisted `metric` is one global per-person preference shared across every exercise in the
  // dropdown, so a bodyweight exercise falls back to est1rm for DISPLAY only -- onMetricChange
  // below still writes the real preference, so picking a weighted exercise again restores it.
  const effectiveMetric = options.some((opt) => opt.value === metric) ? metric : 'est1rm';
  const spec = metricSpec(effectiveMetric);
  // The row backing the <select>'s current value, for the history link's name. Read off the list
  // already in hand rather than fetched: the link and the dropdown must name the same exercise.
  const selectedExercise = loggedExercises.find((pr) => pr.exerciseId === exerciseId);

  return (
    <Card size="dense">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        {/* One text node, deliberately: an e2e spec looks this header up by its full string, and
            RTL's getByText concatenates only direct children. Don't split it into spans. */}
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)' }}>
          Exercise progress &middot; {spec.title}
        </div>
        <ChartHelp help={exerciseTrendHelp(effectiveMetric)} />
      </div>

      <select value={exerciseId || ''} onChange={(e) => onSelectExercise(Number(e.target.value))} style={selectStyle}>
        {loggedExercises.map((pr) => (
          <option key={pr.exerciseId} value={pr.exerciseId}>
            {pr.exerciseName}
          </option>
        ))}
      </select>

      {/* `fill` because five pills at intrinsic width overflow a 390px phone -- see SegmentedToggle. */}
      <div style={{ marginBottom: 12 }}>
        <SegmentedToggle
          options={options}
          value={effectiveMetric}
          onChange={onMetricChange}
          ariaLabel="Exercise metric"
          fill
        />
      </div>

      {loading && <Skeleton width="100%" height={200} radius={8} />}
      {!loading && <ExerciseTrendChart points={points} metric={effectiveMetric} defaultUnit={defaultUnit} />}

      {/* A per-session list of best sets lived here and was removed: the chart above already plots
          every one of those sessions and already marks the PRs with green dots, so the list was the
          same data a second time, and "what did I do last time" is answered mid-workout by
          ExerciseDetail's Last session block. Trends' job is aggregation over time; re-rendering
          what History owns is the mistake .claude/rules/trends.md records under "Trends does not
          re-render what another tab already owns". So it links there instead.

          The exercise NAME is in the aria-label, never the visible text. trends.spec.ts's own
          header warns that bare exercise-name lookups are already ambiguous across the picker,
          History, PRs and this card's header -- adding a fifth on-screen copy is how unrelated
          specs have broken before. */}
      {selectedExercise && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <button
            className="pressable"
            aria-label={`View history for ${selectedExercise.exerciseName}`}
            onClick={() =>
              navigate('/app/history', {
                state: {
                  historyExerciseFilter: {
                    exerciseId: selectedExercise.exerciseId,
                    exerciseName: selectedExercise.exerciseName,
                  },
                },
              })
            }
            style={historyLinkStyle}
          >
            Exercise history &rarr;
          </button>
        </div>
      )}

      <ExerciseRecordsTable records={records} loading={recordsLoading} defaultUnit={defaultUnit} />
    </Card>
  );
}
