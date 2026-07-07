import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';

// PR points reuse the app's existing success-green "PR" status color (see the PR badge in
// ExerciseDetail.jsx) rather than a categorical hue -- this is a state distinction (new
// best-ever vs. not), not an identity one.
function TrendDot({ cx, cy, payload }) {
  const isPr = payload.isPr;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isPr ? 6 : 4}
      fill={isPr ? 'var(--color-success)' : 'var(--color-accent)'}
      stroke="var(--color-surface)"
      strokeWidth={2}
    />
  );
}

function ChartTooltip({ active, payload, defaultUnit }) {
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
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{formatDateLabel(point.date)}</div>
      <div style={{ color: 'var(--color-muted)' }}>
        {point.weightDisplay} {defaultUnit} &times; {point.reps} &middot; est. {point.est1rmDisplay} {defaultUnit}
      </div>
      {point.isPr && <div style={{ color: 'var(--color-success)', fontWeight: 700, marginTop: 2 }}>New PR</div>}
    </div>
  );
}

export default function ExerciseTrendChart({ points, defaultUnit }) {
  if (points.length === 0) {
    return (
      <div style={{ fontSize: 14, color: 'var(--color-faint)', padding: '20px 0', textAlign: 'center' }}>
        No sets logged for this exercise in the selected range.
      </div>
    );
  }

  const data = points.map((p) => ({
    ...p,
    weightDisplay: convertWeight(p.weightLb, 'lb', defaultUnit),
    est1rmDisplay: convertWeight(p.est1rmLb, 'lb', defaultUnit),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="date"
          tickFormatter={formatDateLabel}
          tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
          axisLine={{ stroke: 'var(--color-border)' }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={['dataMin', 'dataMax']}
          tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip content={<ChartTooltip defaultUnit={defaultUnit} />} cursor={{ stroke: 'var(--color-border)' }} />
        <Line
          type="monotone"
          dataKey="est1rmDisplay"
          stroke="var(--color-accent)"
          strokeWidth={2}
          dot={<TrendDot />}
          activeDot={<TrendDot />}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
