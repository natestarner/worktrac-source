import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserMenu from './UserMenu';
import { useAuth } from '../../context/AuthContext';
import { queryClient, LOG_SET_MUTATION_KEY } from '../../lib/queryClient';
import { getQueuedWriteCount } from '../../hooks/useOutboxCount';
import { logLiveSet } from '../../api/sets';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
// Needed only by the in-flight case below: an unmocked dispatch would make a real jsdom fetch,
// which fails and lands the write on failureCount > 0 -- a state the OLD predicate counted too, so
// the test would pass either way and guard nothing. A never-resolving mock is what holds the write
// in the one state that actually distinguishes them.
vi.mock('../../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
  listSessionSets: vi.fn(),
}));

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

// The other half of the space: a write ONLINE and genuinely on the wire, held there by a
// never-resolving mock. Not paused, never failed -- the exact state the banner's count omits.
function startInFlightWrite() {
  onlineManager.setOnline(true);
  logLiveSet.mockReturnValue(new Promise(() => {}));
  const observer = new MutationObserver(queryClient, {
    ...queryClient.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer
    .mutate({ mode: 'live', personId: 7, exerciseId: 1, weight: 100, reps: 5, idempotencyKey: 'k2', clientLoggedAt: 't' })
    .catch(() => {});
}

describe('UserMenu', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.clearAllMocks();
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

  // The gap this guard had. Logout clears the in-memory outbox AND its persisted copy, so a write
  // that is merely ON THE WIRE loses its retry with nothing left to replay from -- yet the banner's
  // display count deliberately reports 0 for it, and that is what the guard used to ask. Narrow in
  // practice (the serial outbox scope means only the LAST write of a drain is ever in flight), but
  // AuthContext's logout comment claims outright that this warning makes the discard "a confirmed
  // choice, not silent data loss".
  it('warns when the only unsynced write is still in flight -- the case the banner count ignores', async () => {
    const logout = vi.fn();
    useAuth.mockReturnValue({ people: [], logout, isAdmin: false });
    startInFlightWrite();
    await waitFor(() => expect(logLiveSet).toHaveBeenCalled());
    // Pinned deliberately: this is the value the guard used to read, and why it stayed silent.
    expect(getQueuedWriteCount(queryClient)).toBe(0);

    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));

    expect(screen.getByText(/synced yet/i)).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  // AppShellSkeleton renders a real Header so the boot paint matches the loaded one, but that
  // whole tree is unmounted the moment ProtectedRoute swaps in AppShell -- taking `open` with it.
  // A menu opened during boot therefore closed itself with no sign the tap was discarded (a 2.7s
  // window under load; see docs/incidents/2026-08-13-e2e-parallel-flakiness.md). The trigger stays
  // rendered so the layout doesn't shift -- it just isn't armed until the real Header mounts.
  it('does not open a menu that boot is about to discard', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: false });
    render(
      <MemoryRouter>
        <UserMenu booting />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: /Account/ });
    expect(trigger).toBeVisible();
    expect(trigger).toBeDisabled();

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Logout' })).not.toBeInTheDocument();
  });

  it('is armed once boot is done', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: false });
    renderMenu();

    expect(screen.getByRole('button', { name: /Account/ })).toBeEnabled();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Logout' })).toBeInTheDocument();
  });
});
