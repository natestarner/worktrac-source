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

  it('editing a not-yet-synced (optimistic) set replaces its pending create instead of queuing EDIT_SET', async () => {
    const set = { id: 'temp-a', weight: 135, reps: 5, unit: 'lb', optimistic: true };
    const { queryClient } = renderWithQuery(
      <EditSetModal set={set} personId={7} exerciseId={1} sessionId={101} onClose={onClose} onSaved={onSaved} />,
    );
    onlineManager.setOnline(false);
    dispatchLogSet(queryClient, 'temp-a');
    await waitFor(() => expect(pendingMutations(queryClient)).toHaveLength(1));

    fireEvent.click(screen.getAllByText('+')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(editSet).not.toHaveBeenCalled();
    const pending = pendingMutations(queryClient);
    expect(pending).toHaveLength(1);
    expect(pending[0].state.variables).toMatchObject({ weight: 140, reps: 5, tempId: 'temp-a' });
    expect(onSaved).toHaveBeenCalled();
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
