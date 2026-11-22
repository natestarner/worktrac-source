import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddPersonModal from './AddPersonModal';
import { addPerson } from '../../api/people';
import { addAndInviteLogin } from '../../api/logins';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { queryClient } from '../../lib/queryClient';
import { queryKeys } from '../../api/queryKeys';

vi.mock('../../api/people', () => ({ addPerson: vi.fn() }));
vi.mock('../../api/logins', () => ({ addAndInviteLogin: vi.fn() }));

// Adding a person is a Tier-3 write and now routes through useGatedMutation, which composes useUI
// (failure toast) and useOnlineStatus (offline gate). Mocked rather than wrapped in real
// providers, matching the convention every other component test here uses.
vi.mock('../../context/UIContext', () => ({ useUI: () => ({ showToast: vi.fn() }) }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));

describe('AddPersonModal validation', () => {
  let refreshPeople;
  let selectPerson;

  beforeEach(() => {
    vi.clearAllMocks();
    addPerson.mockResolvedValue({ id: 5 });
    refreshPeople = vi.fn().mockResolvedValue();
    selectPerson = vi.fn();
    useAuth.mockReturnValue({ refreshPeople });
    useAppState.mockReturnValue({ selectPerson });
  });

  it('shows an error and does not add a person when the name is blank', async () => {
    render(<AddPersonModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    expect(addPerson).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Sam' } });
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument();
  });

  it('adds the person once a name is provided', async () => {
    const onClose = vi.fn();
    render(<AddPersonModal onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addPerson).toHaveBeenCalledWith('Sam'));
    expect(selectPerson).toHaveBeenCalledWith(5);
    expect(onClose).toHaveBeenCalled();
  });

  // ⚠️ THE ROSTER DERIVES FROM PEOPLE TOO, same reasoning queryClient.js already documents for a
  // logged set. Without this, a trainer who adds a client and immediately opens their roster sees
  // it as though the client were not there -- offlineCacheWarm already cached the answer from
  // before this person existed, and nothing about the screen looks wrong.
  //
  // Against the REAL cache, not a spy on invalidateQueries -- a spy passes just as happily on a key
  // nothing observes.
  it('invalidates the roster, which is account-shared and derives from people as well as sets', async () => {
    queryClient.setQueryData(queryKeys.roster(undefined), []);
    render(<AddPersonModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addPerson).toHaveBeenCalledWith('Sam'));
    expect(queryClient.getQueryState(queryKeys.roster(undefined)).isInvalidated).toBe(true);
  });

  // The person bar's quick add stays exactly what it was: a name and nothing else.
  it('asks for no email unless a login is offered', () => {
    render(<AddPersonModal onClose={vi.fn()} />);

    expect(screen.queryByPlaceholderText('them@example.com')).not.toBeInTheDocument();
  });
});

// From Profile's People list on a plan with member logins: an optional email turns the add into an
// add-and-invite.
describe('AddPersonModal with a login offered', () => {
  let refreshPeople;
  let selectPerson;

  beforeEach(() => {
    vi.clearAllMocks();
    addPerson.mockResolvedValue({ id: 5 });
    addAndInviteLogin.mockResolvedValue({});
    refreshPeople = vi.fn().mockResolvedValue();
    selectPerson = vi.fn();
    useAuth.mockReturnValue({ refreshPeople });
    useAppState.mockReturnValue({ selectPerson });
  });

  it('adds a plain person when the email is left empty', async () => {
    render(<AddPersonModal offerLogin onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Leo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addPerson).toHaveBeenCalledWith('Leo'));
    expect(addAndInviteLogin).not.toHaveBeenCalled();
  });

  // ⚠️ BOTH FIELDS IN ONE REQUEST. As two calls a refused invitation would leave the person behind,
  // so a trainer fixing a typo'd address accumulates an orphan roster entry -- and a billable client
  // seat -- per attempt, with no undo on this side.
  it('sends the name and the address together when an email is given', async () => {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(<AddPersonModal offerLogin onAdded={onAdded} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dana' } });
    fireEvent.change(screen.getByPlaceholderText('them@example.com'), { target: { value: ' dana@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add and send invite' }));

    await waitFor(() => expect(addAndInviteLogin).toHaveBeenCalledWith('Dana', 'dana@example.com'));
    expect(addPerson).not.toHaveBeenCalled();
    // Somebody else is being set up to sign in on their own device: the app stays on whoever it was.
    expect(selectPerson).not.toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // The same promise the Profile screen, the invitation email and the privacy policy carry.
  it('states the password promise beside the email field', () => {
    render(<AddPersonModal offerLogin onClose={vi.fn()} />);

    expect(screen.getByText(/never see or set their password/)).toBeInTheDocument();
  });
});
