import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateLabel } from '../../utils/datetime';

function ChartTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
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
        {point.workoutCount} workout{point.workoutCount === 1 ? '' : 's'}
      </div>
    </div>
  );
}

export default function WeeklyFrequencyChart({ weeks }) {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 12px 8px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', padding: '0 8px 8px' }}>Workouts per week</div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={weeks} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="weekStart"
            tickFormatter={formatDateLabel}
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            domain={[0, 'dataMax']}
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-subtle-bg)' }} />
          <Bar dataKey="workoutCount" fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
