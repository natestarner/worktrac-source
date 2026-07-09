import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RoutineFormModal from './RoutineFormModal';

vi.mock('../../api/routines', () => ({ createRoutine: vi.fn(), updateRoutine: vi.fn() }));

const categories = [
  { id: 10, name: 'Push' },
  { id: 20, name: 'Pull' },
];

const exercises = [
  { id: 1, name: 'Bench Press', categoryId: 10 },
  { id: 2, name: 'Squat', categoryId: 10 },
  { id: 3, name: 'Bent-Over Row', categoryId: 20 },
];

describe('RoutineFormModal exercise search', () => {
  it('filters the "Add exercise" list by name and shows a no-results message', () => {
    render(<RoutineFormModal personId={1} routine={null} exercises={exercises} categories={categories} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByRole('button', { name: '+ Bench Press' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Squat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Bent-Over Row' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search exercises'), { target: { value: 'ben' } });

    expect(screen.getByRole('button', { name: '+ Bench Press' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Bent-Over Row' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Squat' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search exercises'), { target: { value: 'zzz' } });
    expect(screen.getByText('No exercises match "zzz".')).toBeInTheDocument();
  });

  it('excludes exercises already added to the routine from the search results', () => {
    render(<RoutineFormModal personId={1} routine={null} exercises={exercises} categories={categories} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));

    expect(screen.queryByRole('button', { name: '+ Bench Press' })).not.toBeInTheDocument();
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
  });
});

describe('RoutineFormModal category filter', () => {
  it('filters the "Add exercise" list by category pill', () => {
    render(<RoutineFormModal personId={1} routine={null} exercises={exercises} categories={categories} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));

    expect(screen.getByRole('button', { name: '+ Bent-Over Row' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Bench Press' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Squat' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: '+ Bench Press' })).toBeInTheDocument();
  });

  it('combines the category pill with the text search', () => {
    render(<RoutineFormModal personId={1} routine={null} exercises={exercises} categories={categories} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    fireEvent.change(screen.getByPlaceholderText('Search exercises'), { target: { value: 'squat' } });

    expect(screen.getByRole('button', { name: '+ Squat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Bench Press' })).not.toBeInTheDocument();
  });

  it('does not show category pills when only one category has unselected exercises', () => {
    const singleCategoryExercises = [
      { id: 1, name: 'Bench Press', categoryId: 10 },
      { id: 2, name: 'Squat', categoryId: 10 },
    ];
    render(
      <RoutineFormModal personId={1} routine={null} exercises={singleCategoryExercises} categories={categories} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    expect(screen.queryByRole('button', { name: 'Push' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
  });

  it('falls back to "All" once a category empties out from adding its last exercise', () => {
    render(<RoutineFormModal personId={1} routine={null} exercises={exercises} categories={categories} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Bent-Over Row' }));

    expect(screen.getByRole('button', { name: '+ Bench Press' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Squat' })).toBeInTheDocument();
  });
});
