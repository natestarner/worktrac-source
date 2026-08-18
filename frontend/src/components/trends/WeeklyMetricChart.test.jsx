import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartTooltip } from './WeeklyMetricChart';
import { weeklyMetricSpec } from './weeklyMetrics';

const payload = [{ payload: { weekStart: '2026-07-13', metricValue: 12450 } }];

describe('weeklyMetricSpec', () => {
  it('resolves each known metric', () => {
    expect(weeklyMetricSpec('sets').dataKey).toBe('totalSets');
    expect(weeklyMetricSpec('reps').dataKey).toBe('totalReps');
    expect(weeklyMetricSpec('volume').dataKey).toBe('totalVolumeLb');
  });

  it('falls back to volume for a metric it does not recognize', () => {
    expect(weeklyMetricSpec(undefined).dataKey).toBe('totalVolumeLb');
    expect(weeklyMetricSpec('nonsense').dataKey).toBe('totalVolumeLb');
  });
});

describe('ChartTooltip', () => {
  it('renders the value in the household unit for a weight metric', () => {
    render(<ChartTooltip active payload={payload} metric="volume" defaultUnit="lb" />);
    expect(screen.getByText('12450 lb')).toBeInTheDocument();
  });

  it('labels a count metric with the metric name rather than a unit', () => {
    render(<ChartTooltip active payload={[{ payload: { weekStart: '2026-07-13', metricValue: 18 } }]} metric="sets" defaultUnit="lb" />);
    expect(screen.getByText('18 sets')).toBeInTheDocument();
  });

  // The regression: the chart body already fell back for an unrecognized metric, but the tooltip
  // read WEEKLY_METRICS[metric] directly and threw on `spec.isWeight`. Because it throws during
  // render, React unmounts the whole tree -- the symptom was the entire page going blank the
  // instant you hovered the chart, with the chart itself looking perfectly fine until then.
  // A slice persisted before this switcher existed hydrated with metric === undefined.
  // See docs/incidents/2026-08-08-trends-hover-blank-page.md.
  it('renders instead of crashing when the persisted metric predates the switcher', () => {
    expect(() =>
      render(<ChartTooltip active payload={payload} metric={undefined} defaultUnit="lb" />),
    ).not.toThrow();
    expect(screen.getByText('12450 lb')).toBeInTheDocument();
  });

  it('renders nothing when recharts reports no active hover', () => {
    const { container } = render(<ChartTooltip active={false} payload={payload} metric="volume" defaultUnit="lb" />);
    expect(container).toBeEmptyDOMElement();
  });
});
