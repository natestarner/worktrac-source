import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoutineFormModal from './RoutineFormModal';
import { createRoutine } from '../../api/routines';

vi.mock('../../api/routines', () => ({ createRoutine: vi.fn(), updateRoutine: vi.fn() }));

// The "Add exercise" pool defaults to the person's favorites/logged list; typing a search
// reveals the whole catalog. There are no category pills anymore -- categories are per-person.
const personExercises = [
  { id: 1, name: 'Bench Press', isFavorite: true },
  { id: 2, name: 'Squat', isFavorite: true },
  { id: 3, name: 'Bent-Over Row', isFavorite: false },
];

const catalog = [
  { id: 1, name: 'Bench Press' },
  { id: 2, name: 'Squat' },
  { id: 3, name: 'Bent-Over Row' },
  { id: 4, name: 'Cable Fly' },
];

function renderModal(props = {}) {
  return render(
    <RoutineFormModal
      personId={1}
      routine={null}
      personExercises={personExercises}
      catalog={catalog}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      {...props}
    />,
  );
}

describe('RoutineFormModal exercise selection', () => {
  it('shows the person list by default and searches the catalog', () => {
    renderModal();

    // Default: the person's list, split into the same two headings as the Log picker.
    expect(screen.getByText('Favorites')).toBeInTheDocument();
    expect(screen.getByText('Other Previously Logged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Bench Press' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Squat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Bent-Over Row' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Cable Fly' })).not.toBeInTheDocument();

    // Searching reveals the whole catalog (incl. non-favorited Cable Fly).
    fireEvent.change(screen.getByPlaceholderText('Search all exercises'), { target: { value: 'ca' } });
    expect(screen.getByRole('button', { name: '+ Cable Fly' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search all exercises'), { target: { value: 'zzz' } });
    expect(screen.getByText('No exercises match "zzz".')).toBeInTheDocument();
  });

  it('excludes exercises already added to the routine', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));

    expect(screen.queryByRole('button', { name: '+ Bench Press' })).not.toBeInTheDocument();
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
  });
});

describe('RoutineFormModal validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRoutine.mockResolvedValue({ id: 1 });
  });

  it('shows an error and does not save when the name is blank', async () => {
    const onSaved = vi.fn();
    renderModal({ onSaved });

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
    renderModal({ onSaved });

    fireEvent.change(screen.getByPlaceholderText('Routine name (e.g. Push Day)'), { target: { value: 'Push Day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));

    expect(await screen.findByText('Add at least one exercise.')).toBeInTheDocument();
    expect(createRoutine).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    expect(screen.queryByText('Add at least one exercise.')).not.toBeInTheDocument();
  });

  it('saves once both a name and an exercise are provided', async () => {
    const onSaved = vi.fn();
    renderModal({ onSaved });

    fireEvent.change(screen.getByPlaceholderText('Routine name (e.g. Push Day)'), { target: { value: 'Push Day' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));

    await waitFor(() => expect(createRoutine).toHaveBeenCalledWith(1, { name: 'Push Day', exerciseIds: [1] }));
    expect(onSaved).toHaveBeenCalled();
  });
});
