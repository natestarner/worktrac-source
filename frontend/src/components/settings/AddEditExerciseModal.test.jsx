import { fireEvent, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import AddEditExerciseModal from './AddEditExerciseModal';
import { addExercise, favoriteExercise } from '../../api/exercises';
import { useUI } from '../../context/UIContext';

// Categories and setup fields are per-person now, so the modal only collects a name; a new
// exercise is created uncategorized and auto-favorited for the active person so it lands in
// their picker. Wrapped in a QueryClientProvider because creating goes through a durable
// mutation (so an offline OR online create both queue through the same outbox path -- see
// below -- and can never hang Save on a dead-but-reachable backend).
vi.mock('../../api/exercises', () => ({ addExercise: vi.fn(), updateExercise: vi.fn(), favoriteExercise: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

function lastAddButton() {
  const addButtons = screen.getAllByRole('button', { name: 'Add' });
  return addButtons[addButtons.length - 1];
}

describe('AddEditExerciseModal', () => {
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    addExercise.mockResolvedValue({ id: 7 });
    favoriteExercise.mockResolvedValue({});
    useUI.mockReturnValue({ showToast });
  });
  afterEach(() => onlineManager.setOnline(true));

  // The measure toggle is the only new decision this feature asks anyone to make, and only when
  // adding their own exercise. It is create-only: the backend has no setter for trackingType,
  // because flipping it would reinterpret every set already logged against the exercise.
  describe('the Reps/Time measure toggle', () => {
    it('creates a timed exercise when Time is chosen, and carries it on the optimistic row', async () => {
      const onSaved = vi.fn();
      renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={onSaved} />);

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Ring Support Hold' } });
      fireEvent.click(screen.getByRole('button', { name: 'Time' }));
      fireEvent.click(lastAddButton());

      // ⚠️ The optimistic row must carry the real choice, not a hardcoded 'strength'. It is what
      // the Log screen reads while the create is still queued -- a wrong value there shows a Reps
      // stepper for a timed exercise and logs reps against it, which the backend rejects with a
      // 400 on sync. A 4xx is terminal for a durable write, so those sets would be destroyed.
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ring Support Hold', trackingType: 'duration', optimistic: true }),
      );

      await waitFor(() =>
        expect(addExercise).toHaveBeenCalledWith({
          name: 'Ring Support Hold',
          idempotencyKey: expect.any(String),
          trackingType: 'duration',
        }),
      );
    });

    it('defaults to Reps', () => {
      renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Reps' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Time' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('is not offered when renaming -- the measure is fixed once sets exist against it', () => {
      renderWithQuery(
        <AddEditExerciseModal exercise={{ id: 3, name: 'Plank' }} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />,
      );
      expect(screen.queryByRole('group', { name: 'Measured in' })).toBeNull();
    });
  });

  it('creates an exercise optimistically -- Save closes immediately with a temp exercise, never awaiting the network', async () => {
    const onSaved = vi.fn();
    renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Cable Row' } });
    fireEvent.click(lastAddButton());

    // onSaved fires synchronously with an optimistic exercise -- this is what keeps Save from ever
    // hanging against a dead-but-reachable (lie-fi) backend.
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cable Row', optimistic: true }));

    // The durable create still replays in the background through the shared outbox mutation and
    // auto-favorites once it syncs.
    await waitFor(() =>
      expect(addExercise).toHaveBeenCalledWith({
        name: 'Cable Row',
        idempotencyKey: expect.any(String),
        trackingType: 'strength',
      }),
    );
    await waitFor(() => expect(favoriteExercise).toHaveBeenCalledWith(5, 7));
  });

  it('shows an error and does not save when the name is blank', async () => {
    const onSaved = vi.fn();
    renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(lastAddButton());

    expect(await screen.findByText('Enter an exercise name.')).toBeInTheDocument();
    expect(addExercise).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Cable Row' } });
    expect(screen.queryByText('Enter an exercise name.')).not.toBeInTheDocument();
  });

  // requireSyncedExercise is what the Routines form passes: its own save sends the created
  // exercise's id straight into a non-durable, non-idempotent createRoutine/updateRoutine call, so
  // it needs a REAL synced id and can't accept the optimistic temp-id path above.
  describe('requireSyncedExercise (e.g. the Routines form)', () => {
    it('awaits the network and closes with the real created exercise', async () => {
      const onSaved = vi.fn();
      renderWithQuery(
        <AddEditExerciseModal exercise={null} personId={5} requireSyncedExercise onClose={vi.fn()} onSaved={onSaved} />,
      );

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Cable Row' } });
      fireEvent.click(lastAddButton());

      await waitFor(() => expect(addExercise).toHaveBeenCalledWith({ name: 'Cable Row', trackingType: 'strength' }));
      await waitFor(() => expect(favoriteExercise).toHaveBeenCalledWith(5, 7));
      expect(onSaved).toHaveBeenCalledWith({ id: 7 });
    });

    it('shows a toast and leaves the modal open (button re-enabled) instead of hanging when the create fails', async () => {
      addExercise.mockRejectedValue(new Error('network error'));
      const onSaved = vi.fn();
      renderWithQuery(
        <AddEditExerciseModal exercise={null} personId={5} requireSyncedExercise onClose={vi.fn()} onSaved={onSaved} />,
      );

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Cable Row' } });
      fireEvent.click(lastAddButton());

      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith("Couldn't create -- check your connection and try again.", { tone: 'error' }),
      );
      expect(onSaved).not.toHaveBeenCalled();
      // The button's accessible name reverts to "Add" once `saving` clears (it shows a spinner with
      // the label hidden while saving) -- wait for that rather than asserting synchronously right
      // after the toast, since the catch and the `finally` that clears `saving` land in the same
      // microtask but the DOM update reaching the accessibility tree can trail by a render.
      await waitFor(() => expect(lastAddButton()).not.toBeDisabled());
    });

    it('shows a "needs a connection" toast and never attempts the request while offline', () => {
      onlineManager.setOnline(false);
      const onSaved = vi.fn();
      renderWithQuery(
        <AddEditExerciseModal exercise={null} personId={5} requireSyncedExercise onClose={vi.fn()} onSaved={onSaved} />,
      );

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Cable Row' } });
      fireEvent.click(lastAddButton());

      expect(showToast).toHaveBeenCalledWith('You need a connection to do that.', { tone: 'info' });
      expect(addExercise).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });
  });
});
