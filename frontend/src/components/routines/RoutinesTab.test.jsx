import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// This tab's data hooks are all mocked, but OfflineDataNotice reads the durable outbox count
// straight off the mutation cache, so the tree still needs a real QueryClient around it.
import { renderWithQuery } from '../../test/queryWrapper';
import RoutinesTab from './RoutinesTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';
import { useRoutines } from '../../hooks/useRoutines';
import { reorderRoutines } from '../../api/routines';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useExercises', () => ({ useExercises: vi.fn() }));
vi.mock('../../hooks/usePersonExercises', () => ({ usePersonExercises: vi.fn() }));
vi.mock('../../hooks/useRoutines', () => ({ useRoutines: vi.fn() }));
vi.mock('../../api/routines', () => ({ removeRoutine: vi.fn(), reorderRoutines: vi.fn() }));

const routine = {
  id: 1,
  name: 'Push day',
  exercises: [{ exerciseId: 1, exerciseName: 'Bench Press' }],
};

describe('RoutinesTab offline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAppState.mockReturnValue({ activePersonId: 7, startRoutine: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7 }, { id: 8 }] });
    useUI.mockReturnValue({ openConfirm: vi.fn() });
    useExercises.mockReturnValue({ exercises: [], refetch: vi.fn() });
    usePersonExercises.mockReturnValue({ exercises: [], refetch: vi.fn() });
    useRoutines.mockReturnValue({
      routines: [routine],
      loading: false,
      isFetching: false,
      refetch: vi.fn(),
      updatedAt: new Date('2026-07-22T15:00:00').getTime(),
    });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('leaves New/Edit/Copy/Delete enabled and hides the offline notice while online', () => {
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);

    expect(screen.getByRole('button', { name: '+ New routine' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy to…' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  // Cheap and high-value: stops a refactor silently deleting an attribute nothing else in this
  // file references. OfflineDisabledWrap clones its child in place, which must preserve it.
  it('anchors "+ New routine" for the onboarding tour', () => {
    const { container } = renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.NEW_ROUTINE}"]`)).not.toBeNull();
  });

  it('disables New/Edit/Copy/Delete and shows the offline data notice while offline', () => {
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole('button', { name: '+ New routine' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy to…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByText(/Offline.*data as of/)).toBeInTheDocument();
  });

  it('still lets a routine be started while offline (purely local, no network)', () => {
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole('button', { name: 'Start routine' })).not.toBeDisabled();
  });
});


// Reordering is a MODE, not always-visible handles: a row already carries Copy to… / Edit /
// Delete / Start routine, and routine CRUD is online-gated so a mode gives exactly one control
// to OfflineDisabledWrap.
//
// Only the KEYBOARD path is exercised here, and that is the whole reason it exists rather than
// dnd-kit's KeyboardSensor: that sensor derives the next slot from measured DOM rects, and jsdom
// lays nothing out. The pointer path is proven in e2e/tests/routine-reorder.spec.ts.
describe('RoutinesTab reordering', () => {
  const push = { id: 1, name: 'Push day', exercises: [{ exerciseId: 1, exerciseName: 'Bench Press' }] };
  const pull = { id: 2, name: 'Pull day', exercises: [{ exerciseId: 2, exerciseName: 'Barbell Row' }] };
  const legs = { id: 3, name: 'Leg day', exercises: [{ exerciseId: 3, exerciseName: 'Back Squat' }] };
  let refetch;

  function setRoutines(list) {
    useRoutines.mockReturnValue({
      routines: list,
      loading: false,
      isFetching: false,
      refetch,
      updatedAt: new Date('2026-07-22T15:00:00').getTime(),
    });
  }

  function enterReorderMode() {
    fireEvent.click(screen.getByRole('button', { name: 'Reorder routines' }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    refetch = vi.fn();
    useAppState.mockReturnValue({ activePersonId: 7, startRoutine: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7 }, { id: 8 }] });
    useUI.mockReturnValue({ openConfirm: vi.fn(), showToast: vi.fn() });
    useExercises.mockReturnValue({ exercises: [], refetch: vi.fn() });
    usePersonExercises.mockReturnValue({ exercises: [], refetch: vi.fn() });
    reorderRoutines.mockResolvedValue([]);
    setRoutines([push, pull, legs]);
  });
  afterEach(() => onlineManager.setOnline(true));

  // One routine cannot be reordered, so the control would be a control that does nothing.
  it('offers no Reorder control with a single routine', () => {
    setRoutines([push]);
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);

    expect(screen.queryByRole('button', { name: 'Reorder routines' })).not.toBeInTheDocument();
  });

  it('swaps the row actions for grip handles on entering the mode, and back again on Done', async () => {
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);

    expect(screen.getAllByRole('button', { name: 'Start routine' })).toHaveLength(3);

    enterReorderMode();
    expect(screen.queryByRole('button', { name: 'Start routine' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ New routine' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder: Push day (1 of 3)' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    });
    expect(screen.getAllByRole('button', { name: 'Start routine' })).toHaveLength(3);
  });

  it('reorders with the arrow keys and announces the move', () => {
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);
    enterReorderMode();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Leg day (3 of 3)' }), { key: 'ArrowUp' });

    expect(screen.getByRole('button', { name: 'Reorder: Leg day (2 of 3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder: Pull day (3 of 3)' })).toBeInTheDocument();
    expect(screen.getByText('Leg day moved to position 2 of 3.')).toBeInTheDocument();
  });

  it('ignores an arrow key that would move a routine out of the list', () => {
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);
    enterReorderMode();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Push day (1 of 3)' }), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Leg day (3 of 3)' }), { key: 'ArrowDown' });

    expect(screen.getByRole('button', { name: 'Reorder: Push day (1 of 3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder: Leg day (3 of 3)' })).toBeInTheDocument();
  });

  // ONE request carrying the whole arrangement, not one per move -- the draft is local until Done.
  it('commits the whole order in a single request on Done', async () => {
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);
    enterReorderMode();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Leg day (3 of 3)' }), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Leg day (2 of 3)' }), { key: 'ArrowUp' });
    expect(reorderRoutines).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    });

    expect(reorderRoutines).toHaveBeenCalledTimes(1);
    expect(reorderRoutines).toHaveBeenCalledWith(7, [3, 1, 2]);
    expect(refetch).toHaveBeenCalled();
  });

  // Opening the mode and closing it again is not a write. Skipping it also stops the gate
  // refusing a no-op offline, which would read as "reordering is broken".
  it('sends nothing when the order was not actually changed', async () => {
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);
    enterReorderMode();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    });

    expect(reorderRoutines).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Start routine' })).toHaveLength(3);
  });

  // A gated write has no outbox behind it, so a failure must not also cost the arrangement the
  // person just built -- the same call ImportDataModal makes by staying open on failure.
  it('keeps the mode open with the draft intact when the commit fails', async () => {
    reorderRoutines.mockRejectedValue(new Error('boom'));
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);
    enterReorderMode();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder: Leg day (3 of 3)' }), { key: 'ArrowUp' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    });

    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder: Leg day (2 of 3)' })).toBeInTheDocument();
  });

  it('disables the Reorder control while offline rather than failing on Done', () => {
    renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole('button', { name: 'Reorder routines' })).toBeDisabled();
  });

  // The draft describes THIS person's routines. RoutinesTab is not remounted on a person switch,
  // so without the reset one person's half-finished arrangement would be showing on another's
  // list -- and Done would commit it against the wrong personId.
  it('abandons an open reorder when the active person changes', () => {
    const { rerender, queryClient } = renderWithQuery(<MemoryRouter><RoutinesTab /></MemoryRouter>);
    enterReorderMode();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();

    // Re-render through the SAME provider instance rather than a fresh one. A new client would
    // remount the whole tree, which would clear the draft for the wrong reason and prove nothing
    // -- what has to hold is that the effect resets it while the component stays mounted.
    useAppState.mockReturnValue({ activePersonId: 8, startRoutine: vi.fn() });
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><RoutinesTab /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder routines' })).toBeInTheDocument();
  });
});
