import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import { LOG_SET_MUTATION_KEY } from '../../lib/queryClient';
import { editSet, logLiveSet } from '../../api/sets';
import EditSetModal from './EditSetModal';

vi.mock('../../api/sets', () => ({
  editSet: vi.fn(),
  deleteSet: vi.fn(),
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
}));

function dispatchLogSet(client, tempId, overrides = {}) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer
    .mutate({
      mode: 'live', personId: 7, sessionId: 101, exerciseId: 1, unit: 'lb', weight: 135, reps: 5,
      tempId, idempotencyKey: `idem-${tempId}`, clientLoggedAt: 't', ...overrides,
    })
    .catch(() => {});
}

function pendingMutations(client) {
  return client.getMutationCache().getAll().filter((m) => m.state.status === 'pending');
}

describe('EditSetModal', () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    editSet.mockResolvedValue({});
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 101 }, set: { id: 999 } });
    onlineManager.setOnline(true);
  });

  afterEach(() => onlineManager.setOnline(true));

  it('editing an already-synced set queues the durable EDIT_SET write with the corrected values', async () => {
    const set = { id: 55, weight: 135, reps: 5, unit: 'lb' };
    renderWithQuery(<EditSetModal set={set} personId={7} exerciseId={1} sessionId={101} onClose={onClose} onSaved={onSaved} />);

    fireEvent.click(screen.getAllByText('+')[0]); // weight stepper's "+", first of the two
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(editSet).toHaveBeenCalledWith(55, { weight: 140, reps: 5 }));
    expect(onSaved).toHaveBeenCalled();
  });

  // Editing a not-yet-synced set used to remove and re-dispatch its pending create -- which always
  // re-registered at the end of the shared outbox scope's array (reordering it out from under any
  // write already queued behind it) and, under lie-fi, risked the backend's idempotency dedup
  // silently discarding the edit if the create had already reached the server. It's now a
  // genuinely separate EDIT_SET write targeting the create's tempId, leaving the create itself
  // completely untouched -- see offlineSetEdits.js and queryClient.js's requireResolvedSetId.
  it('editing a not-yet-synced (optimistic) set queues a genuinely separate EDIT_SET write, without removing or recreating the create', async () => {
    const set = { id: 'temp-a', weight: 135, reps: 5, unit: 'lb', optimistic: true };
    const { queryClient } = renderWithQuery(
      <EditSetModal set={set} personId={7} exerciseId={1} sessionId={101} onClose={onClose} onSaved={onSaved} />,
    );
    onlineManager.setOnline(false);
    dispatchLogSet(queryClient, 'temp-a');
    await waitFor(() => expect(pendingMutations(queryClient)).toHaveLength(1));
    const [createBefore] = pendingMutations(queryClient);

    fireEvent.click(screen.getAllByText('+')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Both the original create (still paused) and a new, separate EDIT_SET write (also paused,
    // targeting the create's tempId) are now queued.
    await waitFor(() => expect(pendingMutations(queryClient)).toHaveLength(2));
    const [create, edit] = pendingMutations(queryClient);
    // Same object, not a remove+recreate -- this is the actual ordering guarantee: the create
    // never left its slot in the shared outbox scope, so it can't be pushed out of enqueue order.
    expect(create).toBe(createBefore);
    expect(create.options.mutationKey[0]).toBe('logSet');
    expect(edit.options.mutationKey[0]).toBe('editSet');
    expect(edit.state.variables).toMatchObject({ setId: 'temp-a', weight: 140, reps: 5 });
    expect(editSet).not.toHaveBeenCalled(); // still paused offline, neither write has dispatched yet
    expect(onSaved).toHaveBeenCalled();
  });

  it("patches the pending create's display (pre-session, no sessionSets row yet) so the edited values show immediately", async () => {
    const set = { id: 'temp-b', weight: 135, reps: 5, unit: 'lb', optimistic: true };
    // No sessionId -- the very first set of a brand-new offline workout, before a session exists.
    const { queryClient } = renderWithQuery(
      <EditSetModal set={set} personId={7} exerciseId={1} sessionId={null} onClose={onClose} onSaved={onSaved} />,
    );
    onlineManager.setOnline(false);
    dispatchLogSet(queryClient, 'temp-b', { sessionId: null });
    await waitFor(() => expect(pendingMutations(queryClient)).toHaveLength(1));

    fireEvent.click(screen.getAllByText('+')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The create's OWN displayed variables reflect the edit immediately (this is what
    // pendingBeforeSession in ExerciseDetail.jsx reads for a pre-session row) -- even though the
    // create still commits its original values once it syncs (see the previous test).
    const create = pendingMutations(queryClient).find((m) => m.options.mutationKey[0] === 'logSet');
    expect(create.state.variables).toMatchObject({ weight: 140, reps: 5 });
  });

  it('patches the sessionSets cache row in place so the new value shows without waiting for sync', async () => {
    const set = { id: 55, weight: 135, reps: 5, unit: 'lb' };
    const { queryClient } = renderWithQuery(<EditSetModal set={set} personId={7} exerciseId={1} sessionId={101} onClose={onClose} onSaved={onSaved} />);
    const { queryKeys } = await import('../../api/queryKeys');
    queryClient.setQueryData(queryKeys.sessionSets(101, 1), [{ id: 55, weight: 135, reps: 5, unit: 'lb' }]);

    fireEvent.click(screen.getAllByText('+')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(queryClient.getQueryData(queryKeys.sessionSets(101, 1))).toEqual([{ id: 55, weight: 140, reps: 5, unit: 'lb' }]);
  });
});
