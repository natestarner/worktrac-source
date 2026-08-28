import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserMenu from './UserMenu';
import { useAuth } from '../../context/AuthContext';
import { queryClient, LOG_SET_MUTATION_KEY } from '../../lib/queryClient';
import { getQueuedWriteCount } from '../../hooks/useOutboxCount';
import { logLiveSet } from '../../api/sets';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

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

  // Cheap and high-value: stops a refactor silently deleting an attribute nothing else in this
  // file references. Checked on the trigger itself, not the (unrelated) menu content.
  it('anchors the trigger button for the onboarding tour', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: false });
    const { container } = renderMenu();
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.ACCOUNT_MENU}"]`)).not.toBeNull();
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

    // Every menu item now carries the originating route as navigation state, so Contact Us can
    // record which screen a bug report came from. Asserted explicitly rather than loosened to
    // `expect.anything()` -- the state is behaviour this menu is responsible for.
    expect(mockNavigate).toHaveBeenCalledWith('/admin', { state: { from: '/' } });
  });

  it('offers Contact Us above Logout and navigates with the originating screen', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: false });
    renderMenu();
    openMenu();

    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toContain('Contact Us');
    expect(items.indexOf('Contact Us')).toBeLessThan(items.indexOf('Logout'));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Contact Us' }));
    // The `from` is what lets a bug report say which screen it came from.
    expect(mockNavigate).toHaveBeenCalledWith('/app/contact', { state: { from: '/' } });
  });

  it('offers Help directly above Contact Us, so self-serve comes before asking a human', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: false });
    renderMenu();
    openMenu();

    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    // Adjacency, not just order: the two belong together as an escalation ladder, and a new
    // item slipped between them would break that reading without failing a looser assertion.
    expect(items.indexOf('Contact Us') - items.indexOf('Help')).toBe(1);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    expect(mockNavigate).toHaveBeenCalledWith('/app/help', { state: { from: '/' } });
  });

  it('keeps every menu label mutually non-containing, so Playwright substring matching stays unambiguous', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: true });
    renderMenu();
    openMenu();

    // Playwright's getByRole(name:) is a case-insensitive SUBSTRING match, so one label
    // containing another makes a selector on the shorter one ambiguous across this whole
    // screen. "Help" was added under that constraint; this is what keeps the next label honest.
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent.toLowerCase());
    for (const a of labels) {
      const containedBy = labels.filter((b) => b !== a && b.includes(a));
      expect(containedBy, `"${a}" is a substring of ${JSON.stringify(containedBy)}`).toEqual([]);
    }
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
