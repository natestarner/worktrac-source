import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PausedLoginScreen from './PausedLoginScreen';

const logout = vi.fn();
let authValue = { user: { email: 'sam@example.com' }, logout };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => authValue }));

let accessValue = { ownerName: 'Nate' };
vi.mock('../../hooks/useAccountAccess', () => ({ useAccountAccess: () => accessValue }));

describe('PausedLoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authValue = { user: { email: 'sam@example.com' }, logout };
    accessValue = { ownerName: 'Nate' };
  });

  afterEach(() => vi.restoreAllMocks());

  /**
   * ⚠️ The single most important sentence on this screen. The honest fear on being told your login
   * stopped working is that a lapsed payment cost you your training history. It did not, and
   * billing.md's promise that workouts are never deleted on Free still holds exactly.
   */
  it('says plainly that nothing has been deleted', () => {
    render(<PausedLoginScreen />);

    expect(screen.getByText(/Nothing has been deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/exactly where you left them/i)).toBeInTheDocument();
  });

  // Answers "who do I ask?". The reader cannot fix this themselves, so the screen has to point at
  // somebody who can.
  it('names the owner as the person who can undo it', () => {
    render(<PausedLoginScreen />);

    expect(screen.getByText(/Nate can turn Pro back on/)).toBeInTheDocument();
  });

  // ownerName is legitimately null (a household with no owner membership, or one with no person).
  // It must read as naming nobody, never as the word "null".
  it('degrades to a generic phrase when the owner is not known', () => {
    accessValue = { ownerName: null };
    render(<PausedLoginScreen />);

    expect(screen.getByText(/The household owner can turn Pro back on/)).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  /**
   * ⚠️ No upgrade control. Managing the plan is MANAGE_BILLING, which is owner-only — so an
   * "Upgrade" button on a MEMBER's screen could only ever 403. Offering a control that can only
   * fail is the same bug as the Remove button that shipped on the owner's own login row.
   */
  it('offers no upgrade control, because a member could never use one', () => {
    render(<PausedLoginScreen />);

    expect(screen.queryByRole('button', { name: /upgrade|subscribe|billing|pro/i })).not.toBeInTheDocument();
  });

  // Without this the screen is a dead end for somebody who has another household to switch to, or
  // who is simply signed in as the wrong person.
  it('is not a dead end -- signing out is still possible', () => {
    render(<PausedLoginScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
