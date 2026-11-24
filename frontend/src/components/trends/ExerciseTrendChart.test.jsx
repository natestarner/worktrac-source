import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExerciseTrendChart from './ExerciseTrendChart';

// jsdom lays nothing out, so recharts draws nothing meaningful here; stub it to plain boxes. What
// is under test is the line beside the chart, not the chart.
vi.mock('recharts', () => {
  const Box = ({ children }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Box,
    LineChart: Box,
    Line: Empty,
    XAxis: Empty,
    YAxis: Empty,
    Tooltip: Empty,
  };
});

function point(date, value) {
  return { date, est1rm: value, weightLb: value, reps: 1, isPr: false };
}

// One workout drew a mostly empty 200px box labelled only "Today", which read as broken on a
// person's first day. The dot stays; one line says what turns it into a trend.
describe('ExerciseTrendChart with one workout', () => {
  it('says the line starts with the next workout', () => {
    render(<ExerciseTrendChart points={[point('2026-11-23', 192.5)]} metric="est1rm" defaultUnit="lb" />);
    expect(screen.getByText('One workout so far. Log it again and the line starts here.')).toBeInTheDocument();
  });

  it('says nothing once there is a line', () => {
    render(
      <ExerciseTrendChart
        points={[point('2026-11-20', 180), point('2026-11-23', 192.5)]}
        metric="est1rm"
        defaultUnit="lb"
      />,
    );
    expect(screen.queryByText(/One workout so far/)).toBeNull();
  });
});
