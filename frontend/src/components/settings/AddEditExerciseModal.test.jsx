import { fireEvent, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import { FAVORITE_MUTATION_KEY } from '../../lib/queryClient';
import { queryKeys } from '../../api/queryKeys';
import AddEditExerciseModal from './AddEditExerciseModal';
import { addExercise, favoriteExercise, listExercises, listPersonExercises } from '../../api/exercises';
import { useUI } from '../../context/UIContext';

// Categories and setup fields are per-person now, so the modal only collects a name; a new
// exercise is created uncategorized and auto-favorited for the active person so it lands in
// their picker. Wrapped in a QueryClientProvider because creating goes through a durable
// mutation (so an offline OR online create both queue through the same outbox path -- see
// below -- and can never hang Save on a dead-but-reachable backend).
// listExercises/listPersonExercises are mocked too because the modal now reads the catalog and the
// person's list to spot a duplicate before it creates one. Both are ordinary cached reads that
// nothing awaits -- see the duplicate-handling block at the bottom of this file.
vi.mock('../../api/exercises', () => ({
  addExercise: vi.fn(),
  updateExercise: vi.fn(),
  favoriteExercise: vi.fn(),
  unfavoriteExercise: vi.fn(),
  listExercises: vi.fn(),
  listPersonExercises: vi.fn(),
}));
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
    listExercises.mockResolvedValue([]);
    listPersonExercises.mockResolvedValue([]);
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

  // Adding an exercise that already exists used to silently make a second one, indistinguishable
  // from the first everywhere the app renders a bare name. The modal now says so BEFORE they
  // commit -- an exercise they already have is not an error, it is the thing they were reaching
  // for. Resolution logic and its own edge cases live in utils/exerciseDuplicates.test.js; this
  // block covers the wiring.
  describe('duplicate handling', () => {
    const benchPress = { id: 42, name: 'Bench Press', trackingType: 'strength', isGlobal: true };

    it('offers to OPEN an exercise that already exists, and creates nothing', async () => {
      listExercises.mockResolvedValue([benchPress]);
      const onSaved = vi.fn();
      renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={onSaved} />);

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Bench Press' } });

      const openButton = await screen.findByRole('button', { name: 'Open Bench Press' });
      expect(screen.getByText('You already have this exercise.')).toBeInTheDocument();
      fireEvent.click(openButton);

      // Handed the EXISTING row, so LogTab selects a real, already-synced exercise.
      expect(onSaved).toHaveBeenCalledWith(benchPress);
      expect(addExercise).not.toHaveBeenCalled();
    });

    it('matches case-insensitively, the same way the server does', async () => {
      listExercises.mockResolvedValue([benchPress]);
      renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'bench press' } });
      expect(await screen.findByRole('button', { name: 'Open Bench Press' })).toBeInTheDocument();
    });

    it('favorites the exercise it opened, so it lands in that person\u2019s picker', async () => {
      listExercises.mockResolvedValue([benchPress]);
      renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Bench Press' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Open Bench Press' }));

      // Mirrors what the create path's auto-favorite does -- "add this exercise" means they expect
      // to find it in their picker afterwards. Durable, so it queues offline like any other write.
      await waitFor(() => expect(favoriteExercise).toHaveBeenCalledWith(5, 42));
    });

    it('does not re-favorite an exercise already in that list', async () => {
      listExercises.mockResolvedValue([benchPress]);
      listPersonExercises.mockResolvedValue([{ ...benchPress, isFavorite: true }]);
      renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Bench Press' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Open Bench Press' }));

      // Flush a macrotask so the durable mutation would definitely have reached its mutationFn --
      // a bare synchronous assertion here would pass even with the guard removed.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(favoriteExercise).not.toHaveBeenCalled();
    });

    it('never dispatches a favorite against a still-queued TEMP exercise', async () => {
      // That exercise's own queued create already auto-favorites, so this would be a redundant
      // DEPENDENT write on an unmapped temp id -- and requireResolvedExerciseId throws a
      // status-less (infinitely retryable) error for those. The outbox scope is strictly serial, so
      // if the create ever died on a definitive 4xx it would wedge the whole outbox.
      listExercises.mockResolvedValue([
        { id: 'temp-exercise-abc', name: 'Zercher Squat', trackingType: 'strength', isGlobal: false, optimistic: true },
      ]);
      const onSaved = vi.fn();
      const { queryClient } = renderWithQuery(
        <AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={onSaved} />,
      );

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Zercher Squat' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Open Zercher Squat' }));

      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'temp-exercise-abc' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Asserted against the mutation CACHE, not against favoriteExercise: requireResolvedExerciseId
      // throws on an unmapped temp id before the api call is ever reached, so `favoriteExercise` not
      // having been called is true whether or not the write was dispatched. What must not exist is
      // the queued mutation itself -- that is the thing that would wedge the serial outbox.
      const favorites = queryClient
        .getMutationCache()
        .getAll()
        .filter((m) => m.options.mutationKey?.[0] === FAVORITE_MUTATION_KEY[0]);
      expect(favorites).toHaveLength(0);
      expect(addExercise).not.toHaveBeenCalled();
    });

    it('suffixes the new exercise with its measure when the name clashes on the other measure', async () => {
      listExercises.mockResolvedValue([{ id: 9, name: 'Plank', trackingType: 'strength', isGlobal: false }]);
      const onSaved = vi.fn();
      renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={onSaved} />);

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Plank' } });
      fireEvent.click(screen.getByRole('button', { name: 'Time' }));

      // Previewed before they commit, so the name they end up with is never a surprise.
      expect(
        await screen.findByText('You have a Plank measured in Reps. This one saves as Plank (Time).'),
      ).toBeInTheDocument();
      fireEvent.click(lastAddButton());

      // Both the optimistic row and the queued create carry the suffixed name -- they must agree,
      // or the picker shows one name and the synced exercise another.
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Plank (Time)', trackingType: 'duration' }));
      await waitFor(() =>
        expect(addExercise).toHaveBeenCalledWith({
          name: 'Plank (Time)',
          idempotencyKey: expect.any(String),
          trackingType: 'duration',
        }),
      );
    });

    it('opens an existing exercise for the Routines caller too, with no network call at all', async () => {
      // requireSyncedExercise needs a real, synced id because createRoutine cannot replay against a
      // temp one. An exercise that already exists always has one, so this path skips the gate.
      listExercises.mockResolvedValue([benchPress]);
      const onSaved = vi.fn();
      renderWithQuery(
        <AddEditExerciseModal exercise={null} personId={5} requireSyncedExercise onClose={vi.fn()} onSaved={onSaved} />,
      );

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Bench Press' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Open Bench Press' }));

      expect(onSaved).toHaveBeenCalledWith(benchPress);
      expect(addExercise).not.toHaveBeenCalled();
    });

    it('puts the opened exercise in the picker immediately, without waiting for the favorite to sync', async () => {
      // FAVORITE has no onMutate, only an invalidation -- and an invalidation is a no-op while
      // paused. Without the optimistic write, "I added it and it isn't in my list" would be true
      // offline and false online, which is a connectivity-shaped difference in a flow that must not
      // have one. Asserted through the CACHE rather than a spy: a spy on invalidateQueries passes
      // just as happily on a key nothing observes.
      listExercises.mockResolvedValue([benchPress]);
      const { queryClient } = renderWithQuery(
        <AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />,
      );
      // The person's list must already exist -- the modal deliberately declines to BUILD it.
      await waitFor(() => expect(queryClient.getQueryData(queryKeys.personExercises(5))).toBeDefined());

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Bench Press' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Open Bench Press' }));

      const listed = queryClient.getQueryData(queryKeys.personExercises(5)).find((e) => e.id === 42);
      expect(listed).toBeDefined();
      expect(listed.isFavorite).toBe(true);
    });

    it('does not invent the person list when it has never been fetched', async () => {
      // Same rule as CREATE_EXERCISE's onSettled: building the entry here would leave a picker whose
      // only member is this one exercise, stamped fresh, for as long as nothing refetches it.
      listExercises.mockResolvedValue([benchPress]);
      listPersonExercises.mockImplementation(() => new Promise(() => {}));
      const { queryClient } = renderWithQuery(
        <AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Bench Press' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Open Bench Press' }));

      expect(queryClient.getQueryData(queryKeys.personExercises(5))).toBeUndefined();
    });

    it('bounds the button label so a very long name cannot become a paragraph', async () => {
      // Names allow 200 characters and this modal is 340px wide. The visible text is truncated and
      // the accessible name matches it -- an aria-label carrying the full name would differ visibly
      // from the label (WCAG 2.5.3).
      const longName = 'Single Arm Half Kneeling Landmine Press';
      listExercises.mockResolvedValue([{ id: 43, name: longName, trackingType: 'strength', isGlobal: false }]);
      renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />);

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: longName } });

      expect(await screen.findByRole('button', { name: 'Open Single Arm Half Kneeling Landmin…' })).toBeInTheDocument();
    });

    it('caps the name field at the length the column can hold', () => {
      // exercises.name is NVARCHAR(200) with no @Size on the request, so a longer name is a 500 --
      // and a 5xx retries forever, wedging the serial outbox.
      renderWithQuery(<AddEditExerciseModal exercise={null} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />);
      expect(screen.getByPlaceholderText('Exercise name')).toHaveAttribute('maxlength', '200');
    });

    it('leaves renaming alone -- no duplicate note, no Open button', async () => {
      listExercises.mockResolvedValue([benchPress]);
      renderWithQuery(
        <AddEditExerciseModal exercise={{ id: 3, name: 'Incline Press' }} personId={5} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Bench Press' } });

      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());
      expect(screen.queryByText('You already have this exercise.')).toBeNull();
    });
  });
});
