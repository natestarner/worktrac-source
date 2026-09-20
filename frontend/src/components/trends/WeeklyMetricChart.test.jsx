import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartTooltip } from './WeeklyMetricChart';
import { countNoun, weeklyMetricSpec } from './weeklyMetrics';

const payload = [{ payload: { weekStart: '2026-07-13', metricValue: 12450 } }];

describe('weeklyMetricSpec', () => {
  it('resolves each known metric', () => {
    expect(weeklyMetricSpec('workouts').dataKey).toBe('workoutCount');
    expect(weeklyMetricSpec('sets').dataKey).toBe('totalSets');
    expect(weeklyMetricSpec('reps').dataKey).toBe('totalReps');
    expect(weeklyMetricSpec('volume').dataKey).toBe('totalVolumeLb');
  });

  it('falls back to workouts, the same metric a first-time visitor sees', () => {
    expect(weeklyMetricSpec(undefined).dataKey).toBe('workoutCount');
    expect(weeklyMetricSpec('nonsense').dataKey).toBe('workoutCount');
  });

  // Workouts absorbed a chart that stood on its own until now, so its `workoutCount` column has to
  // be the one WeeklyFrequencyChart plotted -- reading any other field would silently draw a
  // different, plausible-looking series.
  it('plots the same weekly column the standalone workouts chart did', () => {
    const week = { weekStart: '2026-07-13', workoutCount: 4, totalSets: 31, totalReps: 248, totalVolumeLb: 12450 };
    expect(week[weeklyMetricSpec('workouts').dataKey]).toBe(4);
  });

  it('does not convert a count metric through the weight unit', () => {
    // convertWeight would scale a 4-workout week to 1.8 for a kg household; only `isWeight`
    // metrics go through it, and workouts joined the three that do not.
    expect(weeklyMetricSpec('workouts').isWeight).toBe(false);
  });
});

describe('countNoun', () => {
  it('singularizes a count of one', () => {
    expect(countNoun(weeklyMetricSpec('workouts'), 1)).toBe('workout');
    expect(countNoun(weeklyMetricSpec('sets'), 1)).toBe('set');
    expect(countNoun(weeklyMetricSpec('reps'), 1)).toBe('rep');
  });

  it('leaves every other count plural, including zero', () => {
    expect(countNoun(weeklyMetricSpec('workouts'), 0)).toBe('workouts');
    expect(countNoun(weeklyMetricSpec('workouts'), 3)).toBe('workouts');
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
    expect(screen.getByText('12450 workouts')).toBeInTheDocument();
  });

  // A week with one session is the most common bar this chart draws now that workouts is a metric
  // on it rather than a chart of its own, and the standalone chart it replaced said "1 workout".
  it('says "1 workout", not "1 workouts"', () => {
    render(
      <ChartTooltip
        active
        payload={[{ payload: { weekStart: '2026-07-13', metricValue: 1 } }]}
        metric="workouts"
        defaultUnit="lb"
      />,
    );
    expect(screen.getByText('1 workout')).toBeInTheDocument();
  });

  it('counts sessions for the workouts metric', () => {
    render(
      <ChartTooltip
        active
        payload={[{ payload: { weekStart: '2026-07-13', metricValue: 4 } }]}
        metric="workouts"
        defaultUnit="lb"
      />,
    );
    expect(screen.getByText('4 workouts')).toBeInTheDocument();
  });

  it('renders nothing when recharts reports no active hover', () => {
    const { container } = render(<ChartTooltip active={false} payload={payload} metric="volume" defaultUnit="lb" />);
    expect(container).toBeEmptyDOMElement();
  });
});
