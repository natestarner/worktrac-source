import { onlineManager } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
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
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useExercises', () => ({ useExercises: vi.fn() }));
vi.mock('../../hooks/usePersonExercises', () => ({ usePersonExercises: vi.fn() }));
vi.mock('../../hooks/useRoutines', () => ({ useRoutines: vi.fn() }));
vi.mock('../../api/routines', () => ({ removeRoutine: vi.fn() }));

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
