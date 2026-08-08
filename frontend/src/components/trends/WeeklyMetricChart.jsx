import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';
import SegmentedToggle from '../shared/SegmentedToggle';

// One switchable bar chart rather than three stacked ones -- Trends is used mid-workout on a
// phone, and three more full-height charts would push the exercise section off the screen.
//
// Volume answers "how much load did I move", sets/reps answer "how much work did I do". They
// disagree often: a heavy squat week can outweigh a whole week of accessory work on volume while
// logging fewer sets, which is exactly why set count is the metric the evidence-based apps lead
// with.
export const WEEKLY_METRICS = {
  volume: { label: 'Volume', dataKey: 'totalVolumeLb', isWeight: true },
  sets: { label: 'Sets', dataKey: 'totalSets', isWeight: false },
  reps: { label: 'Reps', dataKey: 'totalReps', isWeight: false },
};

const METRIC_OPTIONS = Object.entries(WEEKLY_METRICS).map(([value, m]) => ({ label: m.label, value }));

function ChartTooltip({ active, payload, metric, defaultUnit }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const spec = WEEKLY_METRICS[metric];
  const value = Math.round(point.metricValue);
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: '8px 12px',
        fontSize: 13,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{formatDateLabel(point.weekStart)}</div>
      <div style={{ color: 'var(--color-muted)' }}>
        {value} {spec.isWeight ? defaultUnit : spec.label.toLowerCase()}
      </div>
    </div>
  );
}

export default function WeeklyMetricChart({ weeks, metric, onMetricChange, defaultUnit }) {
  const spec = WEEKLY_METRICS[metric] || WEEKLY_METRICS.volume;
  // Only the weight metric converts -- sets and reps are counts, and running them through
  // convertWeight would silently scale them by 2.2 for a kg household.
  const data = weeks.map((w) => ({
    ...w,
    metricValue: spec.isWeight ? convertWeight(w[spec.dataKey], 'lb', defaultUnit) : w[spec.dataKey],
  }));

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 12px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 8px 8px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)' }}>
          {spec.isWeight ? `${spec.label} lifted per week (${defaultUnit})` : `${spec.label} per week`}
        </div>
        <SegmentedToggle options={METRIC_OPTIONS} value={metric} onChange={onMetricChange} ariaLabel="Weekly metric" />
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="weekStart"
            tickFormatter={formatDateLabel}
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 'dataMax']}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            content={<ChartTooltip metric={metric} defaultUnit={defaultUnit} />}
            cursor={{ fill: 'var(--color-subtle-bg)' }}
          />
          <Bar dataKey="metricValue" fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
