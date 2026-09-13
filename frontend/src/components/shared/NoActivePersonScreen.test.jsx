import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NoActivePersonScreen from './NoActivePersonScreen';
import { useAccountAccess } from '../../hooks/useAccountAccess';

vi.mock('../../hooks/useAccountAccess', () => ({ useAccountAccess: vi.fn() }));
vi.mock('./AddPersonModal', () => ({ default: () => null }));
// The skeleton pulls in the whole app chrome (router, contexts). This test is about WHICH branch
// renders, not what the skeleton draws -- AppShell.test covers that.
vi.mock('./AppShellSkeleton', () => ({ default: () => <div data-testid="skeleton" /> }));

describe('NoActivePersonScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountAccess.mockReturnValue({ isMember: false });
  });

  // The transient case: AppShell's auto-select fixes it on the next commit, and the skeleton is
  // pixel-identical to what ProtectedRoute showed a frame earlier, so nothing flashes.
  it('shows the skeleton while there are people to select from', () => {
    render(<NoActivePersonScreen people={[{ id: 1, name: 'Nate' }]} />);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('gives an owner with no people the action that resolves it', () => {
    render(<NoActivePersonScreen people={[]} />);

    expect(screen.getByText('No one to log for yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a person' })).toBeInTheDocument();
  });

  // ⚠️ A member reaches this branch by a completely different route: `people` is the
  // SERVER-FILTERED visible set, so a member whose own person was removed sees an empty list even
  // though the household is full. "Add a person" is MANAGE_PEOPLE and would 403 for them --
  // offering it would leave them tapping a button that cannot work, in the one state they have no
  // way out of.
  describe('for a member with nothing visible', () => {
    beforeEach(() => useAccountAccess.mockReturnValue({ isMember: true }));

    it('does not offer an action they would be refused', () => {
      render(<NoActivePersonScreen people={[]} />);
      expect(screen.queryByRole('button', { name: 'Add a person' })).not.toBeInTheDocument();
    });

    it('explains the state and says who can resolve it', () => {
      render(<NoActivePersonScreen people={[]} />);

      expect(screen.getByText('Nothing to show yet')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('household owner');
    });

    // The one exit that always works, and the same real navigation CriticalErrorFallback uses:
    // signing back in re-reads the people list from the server.
    it('still offers the way out', () => {
      render(<NoActivePersonScreen people={[]} />);
      expect(screen.getByRole('link', { name: 'Go to login' })).toHaveAttribute('href', '/login');
    });

    // Reassurance matters most here: this is the state that latches into localStorage, so someone
    // can land in it repeatedly and conclude their training is gone.
    it('reassures that logged work is not lost', () => {
      render(<NoActivePersonScreen people={[]} />);
      expect(screen.getByRole('alert')).toHaveTextContent('still saved');
    });
  });
});
