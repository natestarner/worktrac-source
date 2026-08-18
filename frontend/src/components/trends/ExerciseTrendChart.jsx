import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';
import { metricSpec } from './exerciseMetrics';

// PR points reuse the app's existing success-green "PR" status color (see the PR badge in
// ExerciseDetail.jsx) rather than a categorical hue -- this is a state distinction (new
// best-ever vs. not), not an identity one.
//
// PR marking always tracks the SAME measure, whatever metric is being plotted: `isPr` is a fact
// about the session, not about the current view, and dropping the dots on the other metrics would
// hide the only milestone the chart has. A consequence worth knowing: a green dot need not be the
// high point of the line currently on screen.
//
// That measure is `StatsService#comparableValue` -- est. 1RM for a loaded lift, but the REP COUNT
// for a bodyweight set and SECONDS for a hold. Don't describe it as "est. 1RM" flatly (this
// comment used to, and the chart's help copy inherited the error); see .claude/rules/trends.md.
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

function ChartTooltip({ active, payload, metric, defaultUnit }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const spec = metricSpec(metric);
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
        {spec.title} {Math.round(point.metricValue * 10) / 10} {spec.isWeight ? defaultUnit : 'reps'}
      </div>
      <div style={{ color: 'var(--color-faint)', fontSize: 12, marginTop: 2 }}>
        {point.setCount} set{point.setCount === 1 ? '' : 's'} &middot; best {point.weightDisplay} {defaultUnit} &times; {point.reps}
      </div>
      {point.isPr && <div style={{ color: 'var(--color-success)', fontWeight: 700, marginTop: 2 }}>New PR</div>}
    </div>
  );
}

export default function ExerciseTrendChart({ points, metric, defaultUnit }) {
  if (points.length === 0) {
    return (
      <div style={{ fontSize: 14, color: 'var(--color-faint)', padding: '20px 0', textAlign: 'center' }}>
        No sets logged for this exercise in the selected range.
      </div>
    );
  }

  const spec = metricSpec(metric);
  const data = points.map((p) => ({
    ...p,
    weightDisplay: convertWeight(p.weightLb, 'lb', defaultUnit),
    metricValue: spec.isWeight ? convertWeight(p[spec.dataKey], 'lb', defaultUnit) : p[spec.dataKey],
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
          // Est. 1RM and top weight are read as "am I moving up", where a zero baseline flattens
          // every real change into noise. Volume and rep counts are magnitudes, so they keep the
          // honest zero baseline the weekly bar charts use.
          domain={spec.isWeight && spec.dataKey !== 'sessionVolumeLb' && spec.dataKey !== 'bestSetVolumeLb'
            ? ['dataMin', 'dataMax']
            : [0, 'dataMax']}
          allowDecimals={spec.isWeight}
          tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          content={<ChartTooltip metric={metric} defaultUnit={defaultUnit} />}
          cursor={{ stroke: 'var(--color-border)' }}
        />
        <Line
          type="monotone"
          dataKey="metricValue"
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
