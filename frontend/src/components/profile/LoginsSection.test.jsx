import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginsSection from './LoginsSection';
import { listLogins, inviteLogin, revokeLogin, unlockLogin } from '../../api/logins';

vi.mock('../../api/logins', () => ({
  listLogins: vi.fn(),
  inviteLogin: vi.fn(),
  revokeLogin: vi.fn(),
  unlockLogin: vi.fn(),
}));

const showToast = vi.fn();
// Runs the confirm callback immediately AND records the message, so a test can assert both the
// wording the owner is shown and the call it authorises. ConfirmDialog's own behaviour is tested
// separately.
const openConfirm = vi.fn((message, onConfirm) => onConfirm());
vi.mock('../../context/UIContext', () => ({ useUI: () => ({ showToast, openConfirm }) }));

// The gate's own offline/error behaviour has its own tests; here it is a pass-through so these
// cases are about what the section renders and sends.
vi.mock('../../hooks/useGatedMutation', () => ({
  useGatedMutation: () => ({ online: true, pending: false, run: (fn) => fn }),
}));

vi.mock('../shared/OfflineDisabledWrap', () => ({ default: ({ children }) => children }));
vi.mock('../shared/Modal', () => ({
  default: ({ title, children }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

const ROWS = [
  { personId: 1, personName: 'Nate', status: 'ACTIVE', email: 'nate@example.com', isSelf: true },
  { personId: 2, personName: 'Sam', status: 'NONE', email: null, isSelf: false },
  { personId: 3, personName: 'Alex', status: 'INVITED', email: 'alex@example.com', isSelf: false },
  { personId: 4, personName: 'Robin', status: 'ACTIVE', email: 'robin@example.com', isSelf: false },
];

describe('LoginsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLogins.mockResolvedValue(ROWS);
    inviteLogin.mockResolvedValue({});
    revokeLogin.mockResolvedValue(undefined);
    unlockLogin.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows each person with their login state', async () => {
    render(<LoginsSection />);

    expect(await screen.findByText('Nate')).toBeInTheDocument();
    // Two people hold a login in this fixture (the viewer and Robin), so this is getAllByText --
    // the badge is per row, not a singleton.
    expect(screen.getAllByText('HAS LOGIN')).toHaveLength(2);
    expect(screen.getByText('INVITED')).toBeInTheDocument();
  });

  // Three states, not a boolean: the action differs per state, and "invited" must be
  // distinguishable from "never asked" or the owner cannot tell waiting from not-done.
  it('offers Enable login for nobody-yet and Resend for already-invited', async () => {
    render(<LoginsSection />);

    expect(await screen.findByRole('button', { name: 'Enable login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  });

  // Someone who already has a login has nothing left to do here -- offering "Enable login" again
  // would be a control that can only fail.
  it('offers no invite action for a person who already has a login', async () => {
    listLogins.mockResolvedValue([ROWS[0]]);
    render(<LoginsSection />);

    expect(await screen.findByText('HAS LOGIN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enable login|Resend/ })).not.toBeInTheDocument();
  });

  /**
   * ⚠️ The disclosure is stated BEFORE the email field, and all three parts are required by the
   * plan: what happens on downgrade (and that workouts survive it), what the owner can and cannot
   * do, and the under-13 guidance. This is the screen where somebody decides to hand a login to a
   * child, so it is the screen that has to say it.
   */
  it('states the Pro, transparency and under-13 disclosures before asking for an address', async () => {
    render(<LoginsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable login' }));

    const dialog = screen.getByRole('dialog', { name: 'Enable login for Sam' });
    expect(dialog).toHaveTextContent(/part of Pro/i);
    expect(dialog).toHaveTextContent(/never deleted/i);
    expect(dialog).toHaveTextContent(/never be able to see or set their password/i);
    expect(dialog).toHaveTextContent(/under 13/i);
  });

  it('sends the invite and reloads the list', async () => {
    render(<LoginsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable login' }));

    fireEvent.change(screen.getByPlaceholderText('them@example.com'), {
      target: { value: '  sam@example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    // Trimmed -- a trailing space pasted from a contacts app must not become part of the address.
    await waitFor(() => expect(inviteLogin).toHaveBeenCalledWith(2, 'sam@example.com'));
    await waitFor(() => expect(listLogins).toHaveBeenCalledTimes(2));
  });

  // Resend pre-fills the address already on file: the owner is re-sending to the same person, and
  // retyping it is both friction and a chance to fat-finger a different address.
  it('pre-fills the known address when resending', async () => {
    render(<LoginsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resend' }));

    expect(screen.getByPlaceholderText('them@example.com')).toHaveValue('alex@example.com');
  });

  // A failed READ on a settings screen must not toast: it would fire on every offline visit to
  // Profile for a feature the person was not asking about. The section simply does not render.
  it('renders nothing, and says nothing, when the list cannot be loaded', async () => {
    listLogins.mockRejectedValue(new Error('offline'));
    const { container } = render(<LoginsSection />);

    await waitFor(() => expect(listLogins).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(showToast).not.toHaveBeenCalled();
  });

  // ── Removing a login ────────────────────────────────────────────────────────────────────────

  /**
   * ⚠️ The owner must not be offered Remove on their OWN row. The server refuses it (409) because
   * nothing in the app could put that login back and a household with no owner has nobody left who
   * can invite one -- so the button could only ever fail, which is a bug regardless of the server
   * being safe. `isSelf` is what the client has to go on: every row here is a person in the
   * viewer's own household.
   */
  it('offers Remove login for other people but never for the viewer themselves', async () => {
    render(<LoginsSection />);

    await screen.findByText('Nate');
    // Alex (invited) and Robin (active) can be removed; Nate is the viewer.
    expect(screen.getAllByRole('button', { name: 'Remove login' })).toHaveLength(2);
  });

  // Nothing to withdraw and no login to take away -- the control would have no meaning.
  it('offers no Remove login for somebody who has no login at all', async () => {
    listLogins.mockResolvedValue([ROWS[1]]);
    render(<LoginsSection />);

    await screen.findByText('Sam');
    expect(screen.queryByRole('button', { name: 'Remove login' })).not.toBeInTheDocument();
  });

  /**
   * ⚠️ Both sentences are load-bearing and neither is obvious.
   *
   * 1. Everything else on this screen that says "remove" deletes training data, so without saying
   *    so an owner reasonably assumes this does too -- and hesitates over an access decision that
   *    costs nothing.
   * 2. A revoked member who is offline cannot be reached: on reconnect their token resolves to no
   *    membership and the session tears down with their queued writes undeliverable. There is no
   *    server-side fix, so the honest thing is to say it BEFORE they act, not after.
   */
  it('warns that the person and their workouts stay, and that offline work may not sync', async () => {
    listLogins.mockResolvedValue([ROWS[3]]);
    render(<LoginsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove login' }));

    const [message] = openConfirm.mock.calls[0];
    expect(message).toMatch(/workouts stay/i);
    expect(message).toMatch(/haven't synced/i);
  });

  // A withdrawn invitation is a different event: there is no queued work to lose, and the thing
  // that changes is that the emailed link stops working.
  it('says the link stops working when withdrawing an invitation instead', async () => {
    listLogins.mockResolvedValue([ROWS[2]]);
    render(<LoginsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove login' }));

    const [message] = openConfirm.mock.calls[0];
    expect(message).toMatch(/link in their email stops working/i);
    expect(message).not.toMatch(/haven't synced/i);
  });

  it('removes the login and reloads the list', async () => {
    listLogins.mockResolvedValue([ROWS[3]]);
    render(<LoginsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove login' }));

    await waitFor(() => expect(revokeLogin).toHaveBeenCalledWith(4));
    expect(listLogins).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith('Login removed.');
  });

  it('calls the invitation withdrawn, not the login removed', async () => {
    listLogins.mockResolvedValue([ROWS[2]]);
    render(<LoginsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove login' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Invite withdrawn.'));
  });


  // ── A locked-out member ─────────────────────────────────────────────────────────────────────

  const LOCKED_ROW = {
    personId: 4,
    personName: 'Robin',
    status: 'ACTIVE',
    email: 'robin@example.com',
    isSelf: false,
    lockedUntil: '2026-09-08T10:15:00Z',
  };

  /**
   * ⚠️ Shown BESIDE the status, not instead of it. A locked login is still a login and clears
   * itself in fifteen minutes, so collapsing the two would leave the owner unable to see "they
   * have a login AND cannot use it right now" -- which is exactly the situation they are being
   * asked about when somebody says signing in is broken.
   */
  it('shows a locked member as locked without hiding that they have a login', async () => {
    listLogins.mockResolvedValue([LOCKED_ROW]);
    render(<LoginsSection />);

    expect(await screen.findByText('LOCKED')).toBeInTheDocument();
    expect(screen.getByText('HAS LOGIN')).toBeInTheDocument();
  });

  // The owner is the support desk here: without a control, their only answer is "wait a quarter of
  // an hour", which is not an answer somebody mid-workout wants.
  it('lets the owner clear the lockout', async () => {
    listLogins.mockResolvedValue([LOCKED_ROW]);
    render(<LoginsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(unlockLogin).toHaveBeenCalledWith(4));
    expect(listLogins).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith('Robin can try signing in again.');
  });

  // No lockout, no control -- an Unlock button on a working login is a control that does nothing.
  it('offers no unlock control when nobody is locked out', async () => {
    render(<LoginsSection />);

    await screen.findByText('Nate');
    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();
  });

});
