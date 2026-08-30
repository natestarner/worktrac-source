import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConsistencyHeatmap from './ConsistencyHeatmap';
import { DAYS_PER_WEEK, HEATMAP_WEEKS } from './consistencyGrid';

// Unlike the recharts-based Trends charts (mocked out in TrendsTab.test.jsx because jsdom gives
// ResponsiveContainer zero width), this one is plain DOM and can be asserted on for real -- which
// is exactly why it wasn't built with recharts.

describe('ConsistencyHeatmap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15)); // Wed 2026-07-15, local
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a full 26x7 grid even with no activity', () => {
    render(<ConsistencyHeatmap workoutDays={[]} />);
    expect(screen.getByTestId('consistency-grid').childElementCount).toBe(HEATMAP_WEEKS * DAYS_PER_WEEK);
    expect(screen.getByText('0 active days')).toBeInTheDocument();
  });

  it('paints each active day at the intensity its set count earns', () => {
    render(
      <ConsistencyHeatmap
        workoutDays={[
          { date: '2026-07-13', sessionCount: 1, setCount: 3 },
          { date: '2026-07-14', sessionCount: 1, setCount: 15 },
          { date: '2026-07-15', sessionCount: 2, setCount: 25 },
        ]}
      />,
    );

    expect(screen.getByTestId('heat-2026-07-13')).toHaveAttribute('data-level', '1');
    expect(screen.getByTestId('heat-2026-07-14')).toHaveAttribute('data-level', '3');
    expect(screen.getByTestId('heat-2026-07-15')).toHaveAttribute('data-level', '4');
    expect(screen.getByTestId('heat-2026-07-10')).toHaveAttribute('data-level', '0');
    expect(screen.getByText('3 active days')).toBeInTheDocument();
  });

  it('marks days later this week as future rather than as rest days', () => {
    render(<ConsistencyHeatmap workoutDays={[]} />);
    expect(screen.getByTestId('heat-2026-07-16')).toHaveAttribute('data-level', 'future');
    expect(screen.getByTestId('heat-2026-07-16')).toHaveAccessibleName(/upcoming/);
    expect(screen.getByTestId('heat-2026-07-14')).toHaveAccessibleName(/rest day/);
  });

  it('names every square so the grid is readable without color', () => {
    render(<ConsistencyHeatmap workoutDays={[{ date: '2026-07-15', sessionCount: 1, setCount: 12 }]} />);
    expect(screen.getByTestId('heat-2026-07-15')).toHaveAccessibleName('Wed, Jul 15: 12 sets across 1 workout');
  });

  it('pluralises a two-a-day correctly', () => {
    render(<ConsistencyHeatmap workoutDays={[{ date: '2026-07-15', sessionCount: 2, setCount: 1 }]} />);
    expect(screen.getByTestId('heat-2026-07-15')).toHaveAccessibleName('Wed, Jul 15: 1 set across 2 workouts');
  });

  it('shows a readout on hover and clears it on leave', () => {
    render(<ConsistencyHeatmap workoutDays={[{ date: '2026-07-15', sessionCount: 1, setCount: 8 }]} />);
    const cell = screen.getByTestId('heat-2026-07-15');

    fireEvent.mouseEnter(cell);
    expect(screen.getByText('Wed, Jul 15: 8 sets across 1 workout')).toBeInTheDocument();

    fireEvent.mouseLeave(cell);
    expect(screen.queryByText('Wed, Jul 15: 8 sets across 1 workout')).not.toBeInTheDocument();
  });

  it('also opens the readout on tap, since a touch device never hovers', () => {
    render(<ConsistencyHeatmap workoutDays={[{ date: '2026-07-15', sessionCount: 1, setCount: 8 }]} />);
    fireEvent.click(screen.getByTestId('heat-2026-07-15'));
    expect(screen.getByText('Wed, Jul 15: 8 sets across 1 workout')).toBeInTheDocument();
  });
});
