import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import { LOG_SET_MUTATION_KEY } from '../../lib/queryClient';
import { useUI } from '../../context/UIContext';
import { listSessionSets, deleteSet } from '../../api/sets';
import SessionSummary from './SessionSummary';

vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../api/sets', () => ({
  listSessionSets: vi.fn(),
  deleteSet: vi.fn(),
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
}));

function dispatchLogSet(client, tempId) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer
    .mutate({
      mode: 'live', personId: 7, sessionId: 101, exerciseId: 1, unit: 'lb', weight: 135, reps: 5,
      tempId, idempotencyKey: `idem-${tempId}`, clientLoggedAt: 't',
    })
    .catch(() => {});
}

describe('SessionSummary', () => {
  const onSelectExercise = vi.fn();
  const onChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useUI.mockReturnValue({ openConfirm: (_msg, onConfirm) => onConfirm() });
    listSessionSets.mockResolvedValue([]);
    deleteSet.mockResolvedValue();
    onlineManager.setOnline(true);
  });

  afterEach(() => onlineManager.setOnline(true));

  it('renders each entry with its exercise name and sets', () => {
    const entries = [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ id: 55, weight: 135, reps: 5, unit: 'lb' }] }];
    renderWithQuery(
      <SessionSummary entries={entries} loading={false} sessionId={101} onSelectExercise={onSelectExercise} onChanged={onChanged} />,
    );

    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('135lb×5')).toBeInTheDocument();
  });

  it('removing a fully-synced entry deletes each of its sets via the network (unchanged pre-existing behavior)', async () => {
    listSessionSets.mockResolvedValue([{ id: 55 }, { id: 56 }]);
    const entries = [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ id: 55, weight: 135, reps: 5, unit: 'lb' }] }];
    renderWithQuery(
      <SessionSummary entries={entries} loading={false} sessionId={101} onSelectExercise={onSelectExercise} onChanged={onChanged} />,
    );

    fireEvent.click(screen.getByText('Remove'));

    await waitFor(() => expect(deleteSet).toHaveBeenCalledWith(55));
    expect(deleteSet).toHaveBeenCalledWith(56);
    expect(onChanged).toHaveBeenCalled();
  });

  it('removing an entry that is only offline-logged (not yet synced) cancels its pending create, with no network calls', async () => {
    const entries = [{ exerciseId: 1, exerciseName: 'Bench Press', sets: [{ id: 'temp-a', weight: 135, reps: 5, unit: 'lb', optimistic: true }] }];
    const { queryClient } = renderWithQuery(
      <SessionSummary entries={entries} loading={false} sessionId={null} onSelectExercise={onSelectExercise} onChanged={onChanged} />,
    );

    onlineManager.setOnline(false);
    dispatchLogSet(queryClient, 'temp-a');
    await waitFor(() =>
      expect(queryClient.getMutationCache().getAll().filter((m) => m.state.status === 'pending')).toHaveLength(1),
    );

    fireEvent.click(screen.getByText('Remove'));

    await waitFor(() =>
      expect(queryClient.getMutationCache().getAll().filter((m) => m.state.status === 'pending')).toHaveLength(0),
    );
    expect(listSessionSets).not.toHaveBeenCalled();
    expect(deleteSet).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it('disables Remove offline for an entry with an already-synced set, but not for a purely offline-logged one', async () => {
    const entries = [
      { exerciseId: 1, exerciseName: 'Bench Press', sets: [{ id: 55, weight: 135, reps: 5, unit: 'lb' }] },
      { exerciseId: 2, exerciseName: 'Curl', sets: [{ id: 'temp-c', weight: 30, reps: 10, unit: 'lb', optimistic: true }] },
    ];
    const { queryClient } = renderWithQuery(
      <SessionSummary entries={entries} loading={false} sessionId={101} onSelectExercise={onSelectExercise} onChanged={onChanged} />,
    );

    onlineManager.setOnline(false);
    dispatchLogSet(queryClient, 'temp-c');
    await waitFor(() =>
      expect(queryClient.getMutationCache().getAll().filter((m) => m.state.status === 'pending')).toHaveLength(1),
    );

    const removeButtons = screen.getAllByText('Remove');
    expect(removeButtons[0]).toBeDisabled();
    expect(removeButtons[1]).not.toBeDisabled();
  });

  it('removing a mixed entry (one synced set, one still offline-logged) both cancels the pending create AND removes the synced set (while online -- see the offline-disable test above for the offline case)', async () => {
    listSessionSets.mockResolvedValue([{ id: 55 }]);
    const entries = [
      {
        exerciseId: 1,
        exerciseName: 'Bench Press',
        sets: [
          { id: 55, weight: 135, reps: 5, unit: 'lb' },
          { id: 'temp-b', weight: 140, reps: 3, unit: 'lb', optimistic: true },
        ],
      },
    ];
    renderWithQuery(
      <SessionSummary entries={entries} loading={false} sessionId={101} onSelectExercise={onSelectExercise} onChanged={onChanged} />,
    );

    fireEvent.click(screen.getByText('Remove'));

    await waitFor(() => expect(deleteSet).toHaveBeenCalledWith(55));
    expect(onChanged).toHaveBeenCalled();
  });
});
