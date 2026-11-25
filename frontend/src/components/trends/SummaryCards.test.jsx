import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SummaryCards from './SummaryCards';

function overview(overrides = {}) {
  return {
    currentStreakWeeks: 1,
    workoutsThisWeek: 1,
    workoutsLastWeek: 0,
    volumeThisMonthLb: 2835,
    volumeLastMonthLb: 0,
    ...overrides,
  };
}

// The tiles a new person reads on day one. They said "+1 vs last week (0)" and "2835 lb (new)",
// which made someone stop and decode them; each now says it in words.
describe('SummaryCards wording', () => {
  it.each([
    [1, 0, 'None last week'],
    [0, 0, 'None last week either'],
    [3, 3, 'Same as last week'],
    [4, 2, '2 more than last week (2)'],
    [1, 3, '2 fewer than last week (3)'],
  ])('%i workouts this week against %i last reads "%s"', (thisWeek, lastWeek, text) => {
    render(<SummaryCards overview={overview({ workoutsThisWeek: thisWeek, workoutsLastWeek: lastWeek })} defaultUnit="lb" />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows a first month of volume as the number, with what it lacks on its own line', () => {
    render(<SummaryCards overview={overview()} defaultUnit="lb" />);
    expect(screen.getByText('2835 lb')).toBeInTheDocument();
    expect(screen.getByText('Nothing the 30 days before to compare')).toBeInTheDocument();
    expect(screen.queryByText(/\(new\)/)).toBeNull();
  });

  it('still compares against the month before when there is one', () => {
    render(<SummaryCards overview={overview({ volumeLastMonthLb: 2000, volumeThisMonthLb: 2500 })} defaultUnit="lb" />);
    expect(screen.getByText('+25% vs last month')).toBeInTheDocument();
    expect(screen.queryByText('Nothing the 30 days before to compare')).toBeNull();
  });
});
