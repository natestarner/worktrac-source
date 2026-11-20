import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PausedLoginScreen from './PausedLoginScreen';

const logout = vi.fn();
const switchAccount = vi.fn();
let authValue = { user: { email: 'sam@example.com' }, logout };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => authValue }));

let accessValue = { ownerName: 'Nate' };
vi.mock('../../hooks/useAccountAccess', () => ({ useAccountAccess: () => accessValue }));

const downloadPersonCsv = vi.fn();
vi.mock('../../api/export', () => ({ downloadPersonCsv: (...args) => downloadPersonCsv(...args) }));

// The gate itself is useGatedMutation's own test's job; here it simply runs the action.
vi.mock('../../hooks/useGatedMutation', () => ({
  useGatedMutation: () => ({ pending: false, run: (action) => () => action() }),
}));

let unsyncedCount = 0;
vi.mock('../../hooks/useOutboxCount', () => ({ getUnsyncedWriteCount: () => unsyncedCount }));

function renderScreen() {
  return render(
    <MemoryRouter>
      <PausedLoginScreen />
    </MemoryRouter>,
  );
}

describe('PausedLoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authValue = { user: { email: 'sam@example.com' }, logout };
    accessValue = { ownerName: 'Nate' };
    unsyncedCount = 0;
    switchAccount.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  /**
   * ⚠️ The single most important sentence on this screen. The honest fear on being told your login
   * stopped working is that a lapsed payment cost you your training history. It did not, and
   * billing.md's promise that workouts are never deleted on Free still holds exactly.
   */
  it('says plainly that nothing has been deleted', () => {
    renderScreen();

    expect(screen.getByText(/Nothing has been deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/exactly where you left them/i)).toBeInTheDocument();
  });

  // Answers "who do I ask?". The reader cannot fix this themselves, so the screen has to point at
  // somebody who can.
  it('names the owner as the person who can undo it', () => {
    renderScreen();

    expect(screen.getByText(/Nate can turn it back on/)).toBeInTheDocument();
  });

  // ownerName is legitimately null (a household with no owner membership, or one with no person).
  // It must read as naming nobody, never as the word "null".
  it('degrades to a generic phrase when the owner is not known', () => {
    accessValue = { ownerName: null };
    renderScreen();

    expect(screen.getByText(/The household owner can turn it back on/)).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  /**
   * ⚠️ No upgrade control. Managing the plan is MANAGE_BILLING, which is owner-only — so an
   * "Upgrade" button on a MEMBER's screen could only ever 403. Offering a control that can only
   * fail is the same bug as the Remove button that shipped on the owner's own login row.
   */
  it('offers no upgrade control, because a member could never use one', () => {
    renderScreen();

    expect(screen.queryByRole('button', { name: /upgrade|subscribe|billing|plus/i })).not.toBeInTheDocument();
  });

  // Without this the screen is a dead end for somebody who has another household to switch to, or
  // who is simply signed in as the wrong person.
  it('is not a dead end -- signing out is still possible', () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  // ⚠️ THE TIER THIS SCREEN MUST NOT NAME. It said "part of Huddle Plus" and "turn Plus back on",
  // which is false for a trainer's client whose PRO subscription lapsed -- they were never on Plus.
  // And by the time this renders the account HAS lapsed, so the tier they were on is not knowable
  // from here at all. Naming the paid plans generally is the only statement true on every tier.
  it('names no specific tier, because the one that lapsed is not knowable here', () => {
    renderScreen();

    expect(screen.getByText(/paid plans/)).toBeInTheDocument();
    expect(screen.queryByText(/Huddle Plus/)).not.toBeInTheDocument();
  });

  // The noun still moves with the account, via AccountVocab -- so a client reads about a practice
  // rather than about somebody else's household. (In production the vocab will usually have fallen
  // back to the family nouns by now, since it is derived from the plan and the plan is Free again;
  // the screen must render whichever it is handed rather than assuming one.)
  it('uses the account\'s own noun', () => {
    authValue = {
      user: { email: 'client@example.com' },
      account: { vocab: { account: 'practice', owner: 'trainer', member: 'client', manager: 'assistant' } },
      logout,
    };
    accessValue = { ownerName: null };
    renderScreen();

    expect(screen.getByText(/this practice/)).toBeInTheDocument();
    expect(screen.getByText(/The trainer can turn it back on/)).toBeInTheDocument();
  });

  describe('what the member can do without the owner', () => {
    /**
     * Export is free on every tier, and a member whose household lapsed is exactly who needs it.
     * It downloads THEIR OWN profile -- the one request the server lets a paused login make.
     */
    it('downloads the member\'s own workouts', async () => {
      accessValue = { ownerName: 'Nate', selfPersonId: 42 };
      renderScreen();

      fireEvent.click(screen.getByRole('button', { name: 'Download my workouts' }));

      await waitFor(() => expect(downloadPersonCsv).toHaveBeenCalledWith(42));
    });

    // A membership with no profile has nothing to export, and the server would refuse the request,
    // so the control is not offered at all (member-access.md).
    it('offers no download for a login with no profile of its own', () => {
      accessValue = { ownerName: 'Nate', selfPersonId: null };
      renderScreen();

      expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
    });

    // The household this login was paused in is not offered -- switching to it does nothing.
    it('offers a switch to each OTHER household, and makes it', async () => {
      authValue = {
        user: { email: 'sam@example.com' },
        logout,
        switchAccount,
        account: { id: 20 },
        accounts: [
          { accountId: 20, accountName: 'Test House' },
          { accountId: 1, accountName: 'The Starners' },
        ],
      };
      renderScreen();

      expect(screen.queryByRole('button', { name: 'Switch to Test House' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Switch to The Starners' }));

      await waitFor(() => expect(switchAccount).toHaveBeenCalledWith(1));
    });

    it('offers no switch when this is the only household', () => {
      authValue = {
        user: { email: 'sam@example.com' },
        logout,
        switchAccount,
        account: { id: 20 },
        accounts: [{ accountId: 20, accountName: 'Test House' }],
      };
      renderScreen();

      expect(screen.queryByRole('button', { name: /Switch to/ })).not.toBeInTheDocument();
    });

    /**
     * Unsynced work gets a word first -- and it is suspension, not loss: the paused household's
     * queued writes stay on their own outbox key and land if it upgrades again. Logout's "will be
     * lost" would be false here.
     */
    it('says unsynced changes stay saved before switching, and switches only when confirmed', async () => {
      unsyncedCount = 2;
      authValue = {
        user: { email: 'sam@example.com' },
        logout,
        switchAccount,
        account: { id: 20 },
        accounts: [
          { accountId: 20, accountName: 'Test House' },
          { accountId: 1, accountName: 'The Starners' },
        ],
      };
      renderScreen();

      fireEvent.click(screen.getByRole('button', { name: 'Switch to The Starners' }));

      expect(screen.getByRole('alertdialog', { name: 'Unsynced changes' })).toHaveTextContent(
        '2 changes haven’t synced yet. They’ll stay saved here and sync when you switch back.',
      );
      expect(screen.queryByText(/lost/i)).not.toBeInTheDocument();
      expect(switchAccount).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Switch anyway' }));
      await waitFor(() => expect(switchAccount).toHaveBeenCalledWith(1));
    });
  });
});
