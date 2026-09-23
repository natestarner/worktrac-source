import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';
import { metricSpec } from './exerciseMetrics';
import { dtoVolumeKind, formatVolume, volumeIsWeight } from '../../utils/sessionVolume';

// PR points reuse the app's existing success-green "PR" status color (see the PR badge in
// ExerciseDetail.jsx) rather than a categorical hue -- this is a state distinction (new
// best-ever vs. not), not an identity one.
//
// PR marking always tracks the SAME measure, whatever metric is being plotted: `isPr` is a fact
// about the session, not about the current view, and dropping the dots on the other metrics would
// hide the only milestone the chart has. A consequence worth knowing: a green dot need not be the
// high point of the line currently on screen.
//
// That measure is `SetMeasures#comparableValue` -- est. 1RM for a loaded lift, but the REP COUNT
// for a bodyweight set and SECONDS for a hold. Don't describe it as "est. 1RM" flatly (this
// comment used to, and the chart's help copy inherited the error); see .claude/rules/trends.md.
// A record dot is --color-record-text, the ONE colour a personal record is drawn in app-wide.
// It was --color-success, which made green mean "PR" here and on the Log screen while History
// and the celebration used the warm palette -- one idea, two colours, depending on the tab. Green
// now means nothing record-shaped anywhere. Measured CIEDE2000 20.3 (light) / 19.5 (dark) from
// --color-accent, the line's own colour, and the dot is still 50% larger with a surface-coloured
// stroke, so it reads as a marked point rather than a slightly-off one.
function TrendDot({ cx, cy, payload }) {
  const isPr = payload.isPr;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isPr ? 6 : 4}
      fill={isPr ? 'var(--color-record-text)' : 'var(--color-accent)'}
      stroke="var(--color-surface)"
      strokeWidth={2}
    />
  );
}

// Session volume is in the exercise's own unit (pounds, reps or seconds -- utils/sessionVolume.js),
// which each point names in `volumeKind`; every other metric's unit is fixed by its spec. A point
// cached before volumeKind existed was always pounds, which is dtoVolumeKind's default.
function volumeKindFor(metric, point) {
  return metric === 'sessionVolume' ? dtoVolumeKind(point) : null;
}

function ChartTooltip({ active, payload, metric, defaultUnit }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const spec = metricSpec(metric);
  const volumeKind = volumeKindFor(metric, point);
  const valueText = volumeKind
    ? formatVolume(point[spec.dataKey], volumeKind, defaultUnit)
    : `${Math.round(point.metricValue * 10) / 10} ${spec.isWeight ? defaultUnit : 'reps'}`;
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
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{formatDateLabel(point.date)}</div>
      <div style={{ color: 'var(--color-muted)' }}>
        {spec.title} {valueText}
      </div>
      <div style={{ color: 'var(--color-muted)', fontSize: 12, marginTop: 2 }}>
        {point.setCount} set{point.setCount === 1 ? '' : 's'} &middot; best {point.weightDisplay} {defaultUnit} &times; {point.reps}
      </div>
      {point.isPr && <div style={{ color: 'var(--color-record-text)', fontWeight: 700, marginTop: 2 }}>New PR</div>}
    </div>
  );
}

export default function ExerciseTrendChart({ points, metric, defaultUnit }) {
  // Sits inside a chart card that already has its own heading and range switcher, so this stays a
  // plain line rather than a full EmptyState -- an icon and title here would compete with the
  // card's own. --color-muted, not --color-faint: this is body copy.
  if (points.length === 0) {
    return (
      <div style={{ fontSize: 14, color: 'var(--color-muted)', padding: '20px 0', textAlign: 'center' }}>
        No sets for this exercise in the selected range. Try a wider range above.
      </div>
    );
  }

  const spec = metricSpec(metric);
  // A volume in reps or seconds is not a weight, so a kg household must not scale it by 2.2.
  const isWeight = metric === 'sessionVolume' ? volumeIsWeight(volumeKindFor(metric, points[0])) : spec.isWeight;
  const data = points.map((p) => ({
    ...p,
    weightDisplay: convertWeight(p.weightLb, 'lb', defaultUnit),
    metricValue: isWeight ? convertWeight(p[spec.dataKey], 'lb', defaultUnit) : p[spec.dataKey],
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
          domain={isWeight && metric !== 'sessionVolume' && metric !== 'bestSetVolume'
            ? ['dataMin', 'dataMax']
            : [0, 'dataMax']}
          allowDecimals={isWeight}
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
