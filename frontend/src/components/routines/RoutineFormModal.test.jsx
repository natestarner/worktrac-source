import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoutineFormModal from './RoutineFormModal';
import { createRoutine } from '../../api/routines';

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

describe('RoutineFormModal validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRoutine.mockResolvedValue({ id: 1 });
  });

  it('shows an error and does not save when the name is blank', async () => {
    const onSaved = vi.fn();
    render(<RoutineFormModal personId={1} routine={null} exercises={exercises} categories={categories} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));

    expect(await screen.findByText('Give this routine a name.')).toBeInTheDocument();
    expect(createRoutine).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Routine name (e.g. Push Day)'), { target: { value: 'Push Day' } });
    expect(screen.queryByText('Give this routine a name.')).not.toBeInTheDocument();
  });

  it('shows an error and does not save when no exercises are selected', async () => {
    const onSaved = vi.fn();
    render(<RoutineFormModal personId={1} routine={null} exercises={exercises} categories={categories} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText('Routine name (e.g. Push Day)'), { target: { value: 'Push Day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));

    expect(await screen.findByText('Add at least one exercise.')).toBeInTheDocument();
    expect(createRoutine).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    expect(screen.queryByText('Add at least one exercise.')).not.toBeInTheDocument();
  });

  it('saves once both a name and an exercise are provided', async () => {
    const onSaved = vi.fn();
    render(<RoutineFormModal personId={1} routine={null} exercises={exercises} categories={categories} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText('Routine name (e.g. Push Day)'), { target: { value: 'Push Day' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));

    await waitFor(() => expect(createRoutine).toHaveBeenCalledWith(1, { name: 'Push Day', exerciseIds: [1] }));
    expect(onSaved).toHaveBeenCalled();
  });
});
