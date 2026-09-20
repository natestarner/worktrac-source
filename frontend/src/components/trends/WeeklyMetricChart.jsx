import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';
import SegmentedToggle from '../shared/SegmentedToggle';
import ChartHelp from '../shared/ChartHelp';
import { weeklyMetricHelp } from './chartHelp';
import { WEEKLY_METRIC_OPTIONS, countNoun, weeklyMetricSpec } from './weeklyMetrics';

// One switchable bar chart rather than four stacked ones -- Trends is used mid-workout on a
// phone, and three more full-height charts would push the exercise section off the screen.
// "Workouts" was the fourth of those stacked charts until it moved in here; it was never a
// different kind of chart, just a different column of the same `overview.weeks` row.
//
// The metric table itself now lives in weeklyMetrics.js -- see the note there for why.

// Exported for tests only. The chart body around it can't be asserted in jsdom (recharts'
// ResponsiveContainer has no layout there -- see .claude/rules/trends.md), but the tooltip is
// plain DOM, and it's where the crash was.
export function ChartTooltip({ active, payload, metric, defaultUnit }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const spec = weeklyMetricSpec(metric);
  const value = Math.round(point.metricValue);
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '8px 12px',
        fontSize: 13,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{formatDateLabel(point.weekStart)}</div>
      <div style={{ color: 'var(--color-muted)' }}>
        {value} {spec.isWeight ? defaultUnit : countNoun(spec, value)}
      </div>
    </div>
  );
}

export default function WeeklyMetricChart({ weeks, metric, onMetricChange, defaultUnit }) {
  const spec = weeklyMetricSpec(metric);
  // Only the weight metric converts -- sets and reps are counts, and running them through
  // convertWeight would silently scale them by 2.2 for a kg household.
  const data = weeks.map((w) => ({
    ...w,
    metricValue: spec.isWeight ? convertWeight(w[spec.dataKey], 'lb', defaultUnit) : w[spec.dataKey],
  }));

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '16px 12px 8px' }}>
      {/* The "?" is the last item in the header on every chart, so its right-anchored panel
          always opens inside the card rather than off the edge of a phone screen. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 8px 8px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)' }}>
          {spec.isWeight ? `${spec.label} lifted per week (${defaultUnit})` : `${spec.label} per week`}
        </div>
        <ChartHelp help={weeklyMetricHelp(metric)} />
      </div>
      {/* Its own full-width row, and `fill`, for the reason SegmentedToggle's header gives: past
          ~3 options the pills at intrinsic padding stop fitting an iPhone-portrait card. At three
          they shared the header row with the "?" and fit; the fourth pushed that pair to ~334px
          against a 303px row at 375px, which put the "?" outside the card's right border. `.seg`
          cannot wrap, so it overflows rather than reflowing -- measured, not predicted.
          `.seg-fill`'s tighter pill padding is what buys the room back, and its items floor at
          their own label width, so the four stay on ONE line at every iPhone-portrait width Apple
          still ships (375px and up) instead of splitting two-and-two. At 320px -- the 2016 SE --
          they fit at the natural font but with less margin than separates one platform's
          substitute font from another's, so that width is allowed to wrap; `.seg-fill` does it
          gracefully and nothing overflows. This also matches the exercise switcher directly below
          it, which is five pills solving the same problem the same way. */}
      {/* No side inset, unlike the title row above. The pills need every pixel the card will give
          them at 320px, and 8px a side is ~7% of the usable width there -- enough, measured, to
          decide whether the four fit on one line under a wide font. It also lines the control up
          with the chart body below, which is full-bleed to the card's padding for the same
          reason. */}
      <div style={{ padding: '0 0 8px' }}>
        <SegmentedToggle options={WEEKLY_METRIC_OPTIONS} value={metric} onChange={onMetricChange} ariaLabel="Weekly metric" fill />
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
