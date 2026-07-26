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
import OfflineBanner from './OfflineBanner';

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
    renderWithQuery(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the reassuring offline message while offline', () => {
    onlineManager.setOnline(false);
    renderWithQuery(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(screen.getByRole('status')).toHaveTextContent(/sync when you reconnect/i);
  });

  it('appears and clears as connectivity flips', () => {
    onlineManager.setOnline(true);
    renderWithQuery(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => onlineManager.setOnline(true));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('makes the queued-changes count a clickable summary of what is actually queued', async () => {
    onlineManager.setOnline(false);
    const { queryClient } = renderWithQuery(<OfflineBanner />);
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

  it('closes the outbox detail modal from its Close button', async () => {
    onlineManager.setOnline(false);
    const { queryClient } = renderWithQuery(<OfflineBanner />);
    act(() => {
      dispatchLogSet(queryClient, {
        mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb',
        idempotencyKey: 'b', clientLoggedAt: 't', tempId: 'temp-b',
      });
    });

    fireEvent.click(await screen.findByRole('button', { name: '1 change waiting to sync' }));
    expect(await screen.findByText(/Waiting to sync/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
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
    renderWithQuery(<OfflineBanner />);
    expect(screen.queryByRole('button', { name: 'Go back online' })).not.toBeInTheDocument();
  });

  it('leaves offline mode once the probe confirms the server is reachable', async () => {
    probeReachability.mockResolvedValue(true);
    renderWithQuery(<OfflineBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Go back online' }));

    await waitFor(() => expect(isOfflinePinned()).toBe(false));
    expect(screen.queryByText(/Still can.t reach the server/)).not.toBeInTheDocument();
  });

  it('stays offline and explains why when the probe fails', async () => {
    probeReachability.mockResolvedValue(false);
    renderWithQuery(<OfflineBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Go back online' }));

    expect(await screen.findByText(/Still can.t reach the server.*staying offline/)).toBeInTheDocument();
    expect(isOfflinePinned()).toBe(true);
  });

  it('does not lose the queued outbox count if the probe fails and offline mode is kept', async () => {
    probeReachability.mockResolvedValue(false);
    const { queryClient } = renderWithQuery(<OfflineBanner />);
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
