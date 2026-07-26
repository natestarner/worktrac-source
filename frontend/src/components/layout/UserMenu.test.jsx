import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserMenu from './UserMenu';
import { useAuth } from '../../context/AuthContext';
import { queryClient, LOG_SET_MUTATION_KEY } from '../../lib/queryClient';
import { getQueuedWriteCount } from '../../hooks/useOutboxCount';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

function renderMenu() {
  return render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /Account/ }));
}

// Queue a paused (offline) log-set write on the app's singleton client -- the source UserMenu reads
// its "unsynced changes" count from. Paused means the mutationFn never runs, so no real request.
function queueOfflineWrite() {
  onlineManager.setOnline(false);
  const observer = new MutationObserver(queryClient, {
    ...queryClient.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer
    .mutate({ mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'k1', clientLoggedAt: 't' })
    .catch(() => {});
}

describe('UserMenu', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  afterEach(() => {
    // Drop the paused mutation WITHOUT resuming it (resuming would fire a real request in jsdom).
    queryClient.getMutationCache().clear();
    onlineManager.setOnline(true);
  });

  it('does not show the Admin Portal item for a non-admin user', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: false });
    renderMenu();
    openMenu();

    expect(screen.queryByRole('menuitem', { name: 'Admin Portal' })).not.toBeInTheDocument();
  });

  it('shows the Admin Portal item for an admin user and navigates to /admin on click', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: true });
    renderMenu();
    openMenu();

    const adminItem = screen.getByRole('menuitem', { name: 'Admin Portal' });
    fireEvent.click(adminItem);

    expect(mockNavigate).toHaveBeenCalledWith('/admin');
  });

  it('logs out immediately when there are no unsynced changes', () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ people: [], logout, isAdmin: false });
    renderMenu();
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it('warns before discarding queued offline writes on logout, and only logs out on confirm', async () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ people: [], logout, isAdmin: false });
    queueOfflineWrite();
    await waitFor(() => expect(getQueuedWriteCount(queryClient)).toBe(1));

    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));

    // The warning appears and logout is NOT called yet -- no silent data loss.
    expect(screen.getByText(/synced yet/i)).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitem', { name: /Log out anyway/i }));
    expect(logout).toHaveBeenCalledOnce();
  });
});
