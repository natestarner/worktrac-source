import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoutineFormModal from './RoutineFormModal';
import { createRoutine, updateRoutine } from '../../api/routines';

vi.mock('../../api/routines', () => ({ createRoutine: vi.fn(), updateRoutine: vi.fn() }));

// Saving is a Tier-3 write and now goes through useGatedMutation, which composes useRequireOnline
// (for the offline gate) and useUI (for the failure toast). Mocked rather than wrapped in a real
// UIProvider, matching how every other component test here handles UIContext -- ConfirmDialog's is
// the deliberate exception because it drives a real openConfirm cycle.
vi.mock('../../context/UIContext', () => ({ useUI: () => ({ showToast: vi.fn() }) }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

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
    expect(screen.queryByRole('button', { name: 'Cable Fly' })).not.toBeInTheDocument();

    // Searching reveals the whole catalog (incl. non-favorited Cable Fly), rendered as a
    // plain-name list row rather than a "+ Name" chip.
    fireEvent.change(screen.getByPlaceholderText('Search all exercises'), { target: { value: 'ca' } });
    expect(screen.getByRole('button', { name: 'Cable Fly' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search all exercises'), { target: { value: 'zzz' } });
    expect(screen.getByText('No exercises match "zzz".')).toBeInTheDocument();
  });

  it('keeps an already-added exercise in the picker so it can be added again', () => {
    // This used to assert the opposite: the chip disappeared once added, which is what made a
    // cycling routine (bench, row, bench) unbuildable. A routine is a list of occurrences now.
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));

    expect(screen.getByRole('button', { name: '+ Bench Press' })).toBeInTheDocument();
    expect(screen.getByText('Bench Press')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    expect(screen.getAllByText('Bench Press')).toHaveLength(2);
  });

  it('removes only the copy whose × was tapped', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Squat' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    expect(screen.getAllByText('Bench Press')).toHaveLength(2);

    // Position 1 of 3 -- the FIRST Bench Press. Removing by exercise id (the old behaviour)
    // would have taken both copies with it.
    fireEvent.click(screen.getByRole('button', { name: 'Remove: Bench Press (1 of 3)' }));

    expect(screen.getAllByText('Bench Press')).toHaveLength(1);
    expect(screen.getByText('Squat')).toBeInTheDocument();
  });

  // Pointer/touch dragging goes through dnd-kit, which measures real DOM layout that jsdom
  // never computes -- that path is covered for real in e2e/tests/routines.spec.ts instead. The
  // grip handle's arrow-key path is hand-rolled specifically so it stays real AND testable here
  // (see RoutineFormModal.jsx's file header comment).
  it('reorders one occurrence without disturbing its twin, via the grip handle\'s arrow keys', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Squat' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));

    // Bench, Squat, Bench -> move the last Bench up -> Bench, Bench, Squat.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Bench Press (3 of 3)' }), { key: 'ArrowUp' });

    expect(screen.getByRole('button', { name: 'Remove: Bench Press (1 of 3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove: Bench Press (2 of 3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove: Squat (3 of 3)' })).toBeInTheDocument();
  });

  it('announces a keyboard reorder through the sr-only live region', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Squat' }));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Squat (2 of 2)' }), { key: 'ArrowUp' });

    expect(screen.getByText('Squat moved to position 1 of 2.')).toBeInTheDocument();
  });

  it('a grip handle at either end of the list ignores the arrow key that would move it out of bounds', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Squat' }));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Bench Press (1 of 2)' }), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Squat (2 of 2)' }), { key: 'ArrowDown' });

    expect(screen.getByRole('button', { name: 'Remove: Bench Press (1 of 2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove: Squat (2 of 2)' })).toBeInTheDocument();
  });

  it('clears the search box after adding an exercise from search results', () => {
    renderModal();

    const filterInput = screen.getByPlaceholderText('Search all exercises');
    fireEvent.change(filterInput, { target: { value: 'ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cable Fly' }));

    expect(filterInput).toHaveValue('');
  });
});

describe('RoutineFormModal validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRoutine.mockResolvedValue({ id: 1 });
    updateRoutine.mockResolvedValue({ id: 7 });
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

  it('saves a repeated exercise once per occurrence, in order', async () => {
    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Routine name (e.g. Push Day)'), { target: { value: 'Cycle' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Bent-Over Row' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Bench Press' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));

    // The backend stores one routine_exercises row per position (sort_order 0/1/2) -- there is
    // no unique index on (routine_id, exercise_id), so the duplicate survives the round trip.
    await waitFor(() => expect(createRoutine).toHaveBeenCalledWith(1, { name: 'Cycle', exerciseIds: [1, 3, 1] }));
  });

  it('seeds the form from an existing routine that already repeats an exercise', async () => {
    const routine = { id: 7, name: 'Cycle', exercises: [{ exerciseId: 1 }, { exerciseId: 3 }, { exerciseId: 1 }] };
    renderModal({ routine });

    expect(screen.getAllByText('Bench Press')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateRoutine).toHaveBeenCalledWith(1, 7, { name: 'Cycle', exerciseIds: [1, 3, 1] }));
  });
});
