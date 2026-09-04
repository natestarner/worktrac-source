import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import { LOG_SET_MUTATION_KEY } from '../../lib/queryClient';
import { useAuth } from '../../context/AuthContext';
import { useExercises } from '../../hooks/useExercises';
import { logLiveSet } from '../../api/sets';
import { isOfflinePinned, pinOffline, __resetOfflineModeForTests } from '../../lib/offlineMode';
import { probeReachability } from '../../lib/reachabilityProbe';
import { JUST_SYNCED_MS } from '../../hooks/useJustSynced';
import OfflineBanner from './OfflineBanner';
import ConfirmDialog from './ConfirmDialog';
import { UIProvider } from '../../context/UIContext';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useExercises', () => ({ useExercises: vi.fn() }));
vi.mock('../../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
}));
vi.mock('../../api/exercises', () => ({
  addExercise: vi.fn(),
  favoriteExercise: vi.fn(),
  unfavoriteExercise: vi.fn(),
}));
vi.mock('../../api/notes', () => ({ saveLiveExerciseNote: vi.fn(), saveSessionExerciseNote: vi.fn() }));
vi.mock('../../api/sessions', () => ({ endWorkout: vi.fn() }));
vi.mock('../../lib/reachabilityProbe', () => ({ probeReachability: vi.fn() }));

function dispatchLogSet(client, variables) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer.mutate(variables).catch(() => {});
  return observer;
}

// The banner's outbox modal now owns two destructive actions, both routed through UIContext's one
// confirm dialog -- so these need the real provider AND the dialog mounted beside the banner, the
// same pairing AppShell gives them in the app.
function renderBanner() {
  return renderWithQuery(
    <UIProvider>
      <OfflineBanner />
      <ConfirmDialog />
    </UIProvider>,
  );
}

// Wrapped in a QueryClientProvider because the banner now reads the durable outbox count. With no
// queued writes, the count is 0, so the online/offline visibility behavior is unchanged.
describe('OfflineBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    useExercises.mockReturnValue({ exercises: [{ id: 1, name: 'Bench Press' }] });
    logLiveSet.mockResolvedValue({ isPR: false, best: null, session: { id: 1 }, set: { id: 1 } });
  });

  afterEach(() => onlineManager.setOnline(true));

  it('renders nothing while online with an empty outbox', () => {
    onlineManager.setOnline(true);
    renderBanner();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the reassuring offline message while offline', () => {
    onlineManager.setOnline(false);
    renderBanner();
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(screen.getByRole('status')).toHaveTextContent(/sync when you reconnect/i);
  });

  it('appears and clears as connectivity flips', () => {
    onlineManager.setOnline(true);
    renderBanner();
    expect(screen.queryByRole('status')).toBeNull();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => onlineManager.setOnline(true));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('makes the queued-changes count a clickable summary of what is actually queued', async () => {
    onlineManager.setOnline(false);
    const { queryClient } = renderBanner();
    act(() => {
      dispatchLogSet(queryClient, {
        mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb',
        idempotencyKey: 'a', clientLoggedAt: 't', tempId: 'temp-a',
      });
    });

    const countButton = await screen.findByRole('button', { name: '1 change waiting to sync' });
    expect(countButton).toBeInTheDocument();

    fireEvent.click(countButton);

    expect(await screen.findByText('Waiting to sync (1)')).toBeInTheDocument();
    expect(screen.getByText('Nate — Bench Press', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('logged 135 lb × 5')).toBeInTheDocument();
  });

  // The escape hatch, end to end -- the modal is presentational, so this is the only place the
  // wiring (confirm -> clearOutboxMutations + clearOutbox) is actually exercised.
  describe('clearing the sync list', () => {
    async function openOutboxWithOneQueuedSet() {
      onlineManager.setOnline(false);
      const rendered = renderBanner();
      act(() => {
        dispatchLogSet(rendered.queryClient, {
          mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb',
          idempotencyKey: 'clr', clientLoggedAt: 't', tempId: 'temp-clr',
        });
      });
      fireEvent.click(await screen.findByRole('button', { name: '1 change waiting to sync' }));
      await screen.findByText('Waiting to sync (1)');
      return rendered;
    }

    // Destructive, so it must never fire on the tap. It also closes the modal first: ConfirmDialog
    // is itself a Modal with a focus trap, and stacking two has no coherent answer for Escape.
    it('asks before discarding anything, and discards nothing until confirmed', async () => {
      const { queryClient } = await openOutboxWithOneQueuedSet();

      fireEvent.click(screen.getByRole('button', { name: 'Clear all queued changes' }));

      expect(await screen.findByText(/Discard 1 change that hasn't synced yet/)).toBeInTheDocument();
      expect(queryClient.getMutationCache().getAll()).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(1));
      expect(await screen.findByRole('button', { name: '1 change waiting to sync' })).toBeInTheDocument();
    });

    it('empties the outbox once confirmed, and the banner goes with it', async () => {
      const { queryClient } = await openOutboxWithOneQueuedSet();

      fireEvent.click(screen.getByRole('button', { name: 'Clear all queued changes' }));
      await screen.findByText(/Discard 1 change that hasn't synced yet/);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      });

      await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
      await waitFor(() => expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument());
    });

    it('discards just the one item from its own row', async () => {
      const { queryClient } = await openOutboxWithOneQueuedSet();

      fireEvent.click(screen.getByRole('button', { name: 'Discard Bench Press logged 135 lb × 5' }));
      expect(await screen.findByText(/Discard this change\?/)).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      });

      await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
    });
  });

  // Success used to be communicated only by the banner vanishing. These four cover the one thing
  // that must be true of a confirmation: it appears exactly when the claim is true.
  describe('"All caught up." when the outbox drains', () => {
    it('confirms the drain, then withdraws itself', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      onlineManager.setOnline(false);
      const { queryClient } = renderBanner();
      act(() => {
        dispatchLogSet(queryClient, {
          mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb',
          idempotencyKey: 'drain', clientLoggedAt: 't', tempId: 'temp-drain',
        });
      });
      await screen.findByRole('button', { name: '1 change waiting to sync' });

      await act(async () => {
        onlineManager.setOnline(true);
      });

      expect(await screen.findByText('All caught up.')).toBeInTheDocument();
      expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(JUST_SYNCED_MS + 50);
      });
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      vi.useRealTimers();
    });

    // The ordinary boot. Nothing drained, so claiming a sync would be inventing one.
    it('says nothing on a mount that simply finds an empty outbox', () => {
      onlineManager.setOnline(true);
      renderBanner();
      expect(screen.queryByText('All caught up.')).not.toBeInTheDocument();
    });

    // Merely reconnecting is not evidence anything synced.
    it('says nothing when connectivity flips with nothing queued', () => {
      onlineManager.setOnline(false);
      renderBanner();
      act(() => onlineManager.setOnline(true));
      expect(screen.queryByText('All caught up.')).not.toBeInTheDocument();
    });

    // Queued writes are PAUSED offline and cannot succeed, so a drop to zero while offline means
    // they were discarded -- the opposite of caught up.
    it('says nothing when the outbox empties while still offline', async () => {
      onlineManager.setOnline(false);
      const { queryClient } = renderBanner();
      act(() => {
        dispatchLogSet(queryClient, {
          mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb',
          idempotencyKey: 'discarded', clientLoggedAt: 't', tempId: 'temp-discarded',
        });
      });
      await screen.findByRole('button', { name: '1 change waiting to sync' });

      // What logout does to the outbox, without tearing down the whole session.
      act(() => queryClient.getMutationCache().clear());

      await waitFor(() => expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument());
      expect(screen.queryByText('All caught up.')).not.toBeInTheDocument();
    });
  });

  it('closes the outbox detail modal from its Done button', async () => {
    onlineManager.setOnline(false);
    const { queryClient } = renderBanner();
    act(() => {
      dispatchLogSet(queryClient, {
        mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb',
        idempotencyKey: 'b', clientLoggedAt: 't', tempId: 'temp-b',
      });
    });

    fireEvent.click(await screen.findByRole('button', { name: '1 change waiting to sync' }));
    expect(await screen.findByText(/Waiting to sync/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(/Waiting to sync/)).not.toBeInTheDocument();
  });
});

describe('OfflineBanner "Go back online" button (manually pinned offline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    useExercises.mockReturnValue({ exercises: [{ id: 1, name: 'Bench Press' }] });
    pinOffline();
  });

  afterEach(() => {
    __resetOfflineModeForTests();
    onlineManager.setOnline(true);
  });

  it('does not show the button for plain (non-pinned) hard-offline', () => {
    __resetOfflineModeForTests();
    onlineManager.setOnline(false);
    renderBanner();
    expect(screen.queryByRole('button', { name: 'Go back online' })).not.toBeInTheDocument();
  });

  it('leaves offline mode once the probe confirms the server is reachable', async () => {
    probeReachability.mockResolvedValue(true);
    renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'Go back online' }));

    await waitFor(() => expect(isOfflinePinned()).toBe(false));
    expect(screen.queryByText(/Still can.t reach the server/)).not.toBeInTheDocument();
  });

  it('stays offline and explains why when the probe fails', async () => {
    probeReachability.mockResolvedValue(false);
    renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'Go back online' }));

    expect(await screen.findByText(/Still can.t reach the server.*staying offline/)).toBeInTheDocument();
    expect(isOfflinePinned()).toBe(true);
  });

  it('does not lose the queued outbox count if the probe fails and offline mode is kept', async () => {
    probeReachability.mockResolvedValue(false);
    const { queryClient } = renderBanner();
    act(() => {
      dispatchLogSet(queryClient, {
        mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb',
        idempotencyKey: 'stay-offline', clientLoggedAt: 't', tempId: 'temp-c',
      });
    });
    await screen.findByRole('button', { name: '1 change waiting to sync' });

    fireEvent.click(screen.getByRole('button', { name: 'Go back online' }));
    await screen.findByText(/Still can.t reach the server/);

    expect(screen.getByRole('button', { name: '1 change waiting to sync' })).toBeInTheDocument();
  });
});
