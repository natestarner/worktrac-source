import { useEffect } from 'react';
import { usePrs } from '../../hooks/usePrs';
import { useExerciseTrend } from '../../hooks/useExerciseTrend';
import { useExerciseRecords } from '../../hooks/useExerciseRecords';
import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';
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

export default function ExerciseTrendSection({
  personId,
  exerciseId,
  onSelectExercise,
  weeks,
  metric,
  onMetricChange,
  defaultUnit,
}) {
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

      {points.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {points
            .slice()
            .reverse()
            .map((p) => (
              <div
                key={p.sessionId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--color-subtle-bg)',
                  fontSize: 14,
                }}
              >
                <span style={{ color: 'var(--color-muted)' }}>{formatDateLabel(p.date)}</span>
                <span style={{ fontWeight: 600 }}>
                  {convertWeight(p.weightLb, 'lb', defaultUnit)} {defaultUnit} &times; {p.reps}
                </span>
                {p.isPr && (
                  <span
                    style={{
                      background: 'var(--color-success-bg)',
                      color: 'var(--color-success)',
                      fontSize: 11,
                      fontWeight: 'var(--weight-bold)',
                      padding: '3px 8px',
                      borderRadius: 999,
                      letterSpacing: '0.03em',
                    }}
                  >
                    PR
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      <ExerciseRecordsTable records={records} loading={recordsLoading} defaultUnit={defaultUnit} />
    </Card>
  );
}
