import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RecentPrsCard from './RecentPrsCard';

const prs = [
  { date: '2026-07-14', exerciseId: 1, exerciseName: 'Barbell Bench Press', weightLb: 185, reps: 5, est1rmLb: 215.8 },
  { date: '2026-07-10', exerciseId: 2, exerciseName: 'Pull-Up', weightLb: 0, reps: 12, est1rmLb: 0 },
];

describe('RecentPrsCard', () => {
  it('renders nothing when there are no recent PRs, rather than an empty card', () => {
    const { container } = render(<RecentPrsCard recentPrs={[]} defaultUnit="lb" onSelectExercise={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('survives a missing list', () => {
    const { container } = render(<RecentPrsCard recentPrs={null} defaultUnit="lb" onSelectExercise={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts the PRs and lists each with its weight and reps', () => {
    render(<RecentPrsCard recentPrs={prs} defaultUnit="lb" onSelectExercise={vi.fn()} />);

    expect(screen.getByText('2 PRs')).toBeInTheDocument();
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText(/185 lb × 5/)).toBeInTheDocument();
  });

  it('reports a bodyweight PR in reps, not as a 0 lb lift', () => {
    render(<RecentPrsCard recentPrs={prs} defaultUnit="lb" onSelectExercise={vi.fn()} />);

    expect(screen.getByText(/12 reps/)).toBeInTheDocument();
    expect(screen.queryByText(/0 lb/)).not.toBeInTheDocument();
  });

  it('converts to the household unit', () => {
    render(<RecentPrsCard recentPrs={prs} defaultUnit="kg" onSelectExercise={vi.fn()} />);
    expect(screen.getByText(/84 kg × 5/)).toBeInTheDocument();
  });

  it('singularises a lone PR', () => {
    render(<RecentPrsCard recentPrs={[prs[0]]} defaultUnit="lb" onSelectExercise={vi.fn()} />);
    expect(screen.getByText('1 PR')).toBeInTheDocument();
  });

  it('retargets the exercise section when a row is tapped', () => {
    const onSelectExercise = vi.fn();
    render(<RecentPrsCard recentPrs={prs} defaultUnit="lb" onSelectExercise={onSelectExercise} />);

    fireEvent.click(screen.getByRole('button', { name: /Barbell Bench Press PR/ }));
    expect(onSelectExercise).toHaveBeenCalledWith(1);
  });

  it('announces the achievement, so several PRs on one lift are told apart', () => {
    // A productive week means repeat PRs on the SAME exercise. Naming every row after just the
    // exercise made them indistinguishable to a screen reader (and a strict-mode violation).
    render(
      <RecentPrsCard
        recentPrs={[
          { ...prs[0], date: '2026-07-14', weightLb: 185, reps: 5 },
          { ...prs[0], date: '2026-07-11', weightLb: 180, reps: 5 },
        ]}
        defaultUnit="lb"
        onSelectExercise={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Barbell Bench Press PR: 185 lb for 5 reps/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Barbell Bench Press PR: 180 lb for 5 reps/ })).toBeInTheDocument();
  });

  it('announces a bodyweight PR in reps', () => {
    render(<RecentPrsCard recentPrs={prs} defaultUnit="lb" onSelectExercise={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Pull-Up PR: 12 reps/ })).toBeInTheDocument();
  });
});
