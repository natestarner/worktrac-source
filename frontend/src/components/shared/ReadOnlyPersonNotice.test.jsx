import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReadOnlyPersonNotice from './ReadOnlyPersonNotice';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const PEOPLE = [
  { id: 1, name: 'Nate', isPrimary: true },
  { id: 2, name: 'Samuel', isPrimary: false },
];

function signedInAs({ accountRole, personId }, activePersonId) {
  useAppState.mockReturnValue({ activePersonId });
  useAuth.mockReturnValue({
    people: PEOPLE,
    membership: accountRole ? { accountRole, personId, membersSeeEveryone: true } : null,
  });
}

describe('ReadOnlyPersonNotice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says nothing to an owner', () => {
    signedInAs({ accountRole: 'OWNER', personId: 1 }, 2);
    const { container } = render(<ReadOnlyPersonNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing to a member looking at their own data', () => {
    signedInAs({ accountRole: 'MEMBER', personId: 2 }, 2);
    const { container } = render(<ReadOnlyPersonNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  // The reason this component exists: on an iPad or iPhone there is no hover, so the `title` on
  // each greyed control is invisible and the ONLY signal would be the grey itself -- which reads
  // as the app being broken rather than as a rule.
  it('names the person a member is looking at, when it is not them', () => {
    signedInAs({ accountRole: 'MEMBER', personId: 2 }, 1);
    render(<ReadOnlyPersonNotice />);

    expect(screen.getByRole('status')).toHaveTextContent('Viewing Nate’s workouts');
  });

  // Says what you CAN do rather than what is withheld -- the same framing rule billing.md applies
  // to the Free-tier history window.
  it('frames it as viewing rather than as a refusal', () => {
    signedInAs({ accountRole: 'MEMBER', personId: 2 }, 1);
    render(<ReadOnlyPersonNotice />);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('You can look');
    expect(notice.textContent).not.toMatch(/permission|denied|not allowed|restricted/i);
  });

  // An unknown membership (a v1 auth snapshot, adopted at offline boot) falls open, exactly like
  // useAccountAccess -- an owner offline must not be told they are only viewing.
  it('says nothing when the membership is not known yet', () => {
    signedInAs({}, 1);
    const { container } = render(<ReadOnlyPersonNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});
