import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PeopleSection from './PeopleSection';
import { listLogins, inviteLogin, revokeLogin, unlockLogin, setLoginRole } from '../../api/logins';
import { removePerson, updatePerson } from '../../api/people';

vi.mock('../../api/logins', () => ({
  listLogins: vi.fn(),
  addAndInviteLogin: vi.fn(),
  inviteLogin: vi.fn(),
  revokeLogin: vi.fn(),
  unlockLogin: vi.fn(),
  setLoginRole: vi.fn(),
}));
vi.mock('../../api/people', () => ({ removePerson: vi.fn(), updatePerson: vi.fn() }));

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
// The add modal has its own tests (AddPersonModal.test.jsx); here only whether it is offered, and
// with or without the login field.
vi.mock('../shared/AddPersonModal', () => ({
  default: ({ offerLogin }) => <div role="dialog" aria-label="Add a person" data-offer-login={String(offerLogin)} />,
}));

const ROWS = [
  { personId: 1, personName: 'Nate', status: 'ACTIVE', email: 'nate@example.com', isSelf: true, role: 'OWNER' },
  { personId: 2, personName: 'Sam', status: 'NONE', email: null, isSelf: false, role: null },
  { personId: 3, personName: 'Alex', status: 'INVITED', email: 'alex@example.com', isSelf: false, role: null },
  { personId: 4, personName: 'Robin', status: 'ACTIVE', email: 'robin@example.com', isSelf: false, role: 'MEMBER' },
];

// The roster always comes from `people` (the auth snapshot); the login rows are layered on.
const peopleFor = (rows) => rows.map((r) => ({ id: r.personId, name: r.personName, isPrimary: r.personId === 1 }));

function renderSection(props = {}, rows = ROWS) {
  return render(
    <MemoryRouter>
      <PeopleSection people={peopleFor(rows)} refreshPeople={vi.fn().mockResolvedValue()} {...props} />
    </MemoryRouter>,
  );
}

const rowOf = (name) => screen.getByRole('button', { name: `Edit ${name}` });
async function openSheet(name) {
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${name}` }));
  return screen.getByRole('dialog', { name });
}

describe('PeopleSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLogins.mockResolvedValue(ROWS);
    inviteLogin.mockResolvedValue({});
    revokeLogin.mockResolvedValue(undefined);
    unlockLogin.mockResolvedValue(undefined);
    removePerson.mockResolvedValue(undefined);
    updatePerson.mockResolvedValue({});
  });

  afterEach(() => vi.restoreAllMocks());

  // ── At a glance ─────────────────────────────────────────────────────────────────────────────

  it('lists everyone once, with how each of them signs in, without opening anything', async () => {
    renderSection();

    expect(await screen.findByText('Signs in as robin@example.com')).toBeInTheDocument();
    expect(screen.getByText('Signs in as nate@example.com')).toBeInTheDocument();
    expect(screen.getByText('Invite sent to alex@example.com')).toBeInTheDocument();
    expect(screen.getByText('No login')).toBeInTheDocument();
    expect(within(rowOf('Nate')).getByText('Owner')).toBeInTheDocument();
    expect(within(rowOf('Nate')).getByText('You')).toBeInTheDocument();
    expect(within(rowOf('Alex')).getByText('Invited')).toBeInTheDocument();
  });

  // ⚠️ The roster must not wait on, or vanish with, the live login read. People come from the
  // auth snapshot and are here offline; only the login facts need a connection.
  it('still lists everyone when the login details cannot be loaded, and says why', async () => {
    listLogins.mockRejectedValue(new Error('offline'));
    renderSection();

    expect(await screen.findByText(/Login details need a connection/)).toBeInTheDocument();
    ['Nate', 'Sam', 'Alex', 'Robin'].forEach((name) => expect(rowOf(name)).toBeInTheDocument());
    expect(screen.queryByText(/Signs in as/)).not.toBeInTheDocument();
    // A failed READ on a settings screen must not toast.
    expect(showToast).not.toHaveBeenCalled();
  });

  it('offers to add a person, with a login field when the plan includes logins', async () => {
    renderSection({ plan: 'PLUS' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add a person' }));

    expect(screen.getByRole('dialog', { name: 'Add a person' })).toHaveAttribute('data-offer-login', 'true');
  });

  it('offers no login field when adding a person on Free', async () => {
    renderSection({ plan: 'FREE' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add a person' }));

    expect(screen.getByRole('dialog', { name: 'Add a person' })).toHaveAttribute('data-offer-login', 'false');
  });

  // ── Enable login / Resend ───────────────────────────────────────────────────────────────────

  // Three states, not a boolean: the action differs per state. No `plan` prop is passed -- this
  // also pins the fail-open default (an unknown plan behaves like Plus).
  it('offers Enable login for nobody-yet and Resend for already-invited', async () => {
    renderSection();

    expect(within(await openSheet('Sam')).getByRole('button', { name: 'Enable login' })).toBeInTheDocument();
    expect(within(await openSheet('Alex')).getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  });

  // Someone who already has a login has nothing left to do here -- offering "Enable login" again
  // would be a control that can only fail.
  it('offers no invite action for a person who already has a login', async () => {
    renderSection();
    const sheet = await openSheet('Robin');

    expect(within(sheet).queryByRole('button', { name: /Enable login|Resend/ })).not.toBeInTheDocument();
  });

  // ── On a Free household ─────────────────────────────────────────────────────────────────────
  //
  // `MembershipInviteService.invite` refuses on Free with a 409, so offering Enable-login/Resend is
  // exactly the "control the server will refuse" case member-access.md forbids.

  it('says once, above the list, that logins are part of Plus', async () => {
    renderSection({ plan: 'FREE' });

    await screen.findByText('Signs in as nate@example.com');
    const links = screen.getAllByRole('link', { name: 'Unlock with Plus' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/app/billing');
  });

  it('offers Plus instead of Enable login/Resend inside the sheet on Free', async () => {
    renderSection({ plan: 'FREE' });
    const sheet = await openSheet('Sam');

    expect(within(sheet).getByRole('link', { name: 'Unlock with Plus' })).toHaveAttribute('href', '/app/billing');
    expect(within(sheet).queryByRole('button', { name: /Enable login|Resend/ })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('link', { name: 'Unlock with Plus' }));
    expect(inviteLogin).not.toHaveBeenCalled();
  });

  // ── The invite modal ────────────────────────────────────────────────────────────────────────

  /**
   * ⚠️ The disclosure is stated BEFORE the email field, and all three parts are required by the
   * plan: what happens on downgrade (and that workouts survive it), what the owner can and cannot
   * do, and the under-13 guidance.
   */
  it('states the plan, transparency and under-13 disclosures before asking for an address', async () => {
    renderSection({ plan: 'PLUS' });
    fireEvent.click(within(await openSheet('Sam')).getByRole('button', { name: 'Enable login' }));

    const dialog = screen.getByRole('dialog', { name: 'Enable login for Sam' });
    expect(dialog).toHaveTextContent(/part of Plus/i);
    expect(dialog).toHaveTextContent(/never deleted/i);
    expect(dialog).toHaveTextContent(/never be able to see or set their password/i);
    expect(dialog).toHaveTextContent(/under 13/i);
  });

  // A trainer who pays for Pro must not be told logins "are part of Plus". The noun moves too.
  it('names the plan the account is actually on, and the account by its own noun', async () => {
    renderSection({
      plan: 'PRO',
      vocab: { account: 'practice', owner: 'trainer', member: 'client', manager: 'assistant' },
    });
    fireEvent.click(within(await openSheet('Sam')).getByRole('button', { name: 'Enable login' }));

    const dialog = screen.getByRole('dialog', { name: 'Enable login for Sam' });
    expect(dialog).toHaveTextContent(/part of Pro/i);
    expect(dialog).toHaveTextContent(/this practice goes back to Free/i);
    expect(dialog).not.toHaveTextContent(/part of Plus/i);
  });

  // A tier this bundle predates (resilience.md axis D).
  it('falls back to a plain phrase rather than guessing a tier it does not know', async () => {
    renderSection({ plan: 'TEAM' });
    fireEvent.click(within(await openSheet('Sam')).getByRole('button', { name: 'Enable login' }));

    expect(screen.getByRole('dialog', { name: 'Enable login for Sam' })).toHaveTextContent(/part of your plan/i);
  });

  it('sends the invite and reloads the list', async () => {
    renderSection();
    fireEvent.click(within(await openSheet('Sam')).getByRole('button', { name: 'Enable login' }));

    fireEvent.change(screen.getByPlaceholderText('them@example.com'), {
      target: { value: '  sam@example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    // Trimmed -- a trailing space pasted from a contacts app must not become part of the address.
    await waitFor(() => expect(inviteLogin).toHaveBeenCalledWith(2, 'sam@example.com'));
    await waitFor(() => expect(listLogins).toHaveBeenCalledTimes(2));
  });

  // Resend pre-fills the address already on file.
  it('pre-fills the known address when resending', async () => {
    renderSection();
    fireEvent.click(within(await openSheet('Alex')).getByRole('button', { name: 'Resend' }));

    expect(screen.getByPlaceholderText('them@example.com')).toHaveValue('alex@example.com');
  });

  // ── Removing a login ────────────────────────────────────────────────────────────────────────

  /**
   * ⚠️ The owner must not be offered Remove login on their OWN row: the server refuses it (409)
   * because nothing in the app could put it back.
   */
  it('never offers Remove login on the viewer themselves', async () => {
    renderSection();
    const sheet = await openSheet('Nate');

    expect(within(sheet).queryByRole('button', { name: /Remove login|Withdraw invite/ })).not.toBeInTheDocument();
  });

  it('offers no Remove login for somebody who has no login at all', async () => {
    renderSection();
    const sheet = await openSheet('Sam');

    expect(within(sheet).queryByRole('button', { name: /Remove login|Withdraw invite/ })).not.toBeInTheDocument();
  });

  /**
   * ⚠️ Both sentences are load-bearing: the person and their workouts stay (the sheet's other
   * "remove" deletes training data), and a revoked member who is offline may lose unsynced work.
   */
  it('warns that the person and their workouts stay, and that offline work may not sync', async () => {
    renderSection();
    fireEvent.click(within(await openSheet('Robin')).getByRole('button', { name: 'Remove login' }));

    const [message, , options] = openConfirm.mock.calls[0];
    expect(options.title).toBe("Remove Robin's login?");
    expect(options.confirmLabel).toBe('Remove login');
    expect(message).toMatch(/workouts stay/i);
    expect(message).toMatch(/haven't synced/i);
    await waitFor(() => expect(revokeLogin).toHaveBeenCalledWith(4));
    expect(showToast).toHaveBeenCalledWith('Login removed.');
    await waitFor(() => expect(listLogins).toHaveBeenCalledTimes(2));
  });

  it('withdraws an invitation, saying the link stops working', async () => {
    renderSection();
    fireEvent.click(within(await openSheet('Alex')).getByRole('button', { name: 'Withdraw invite' }));

    const [message, , options] = openConfirm.mock.calls[0];
    expect(options.title).toBe("Withdraw Alex's invite?");
    expect(message).toMatch(/link in their email will stop working/i);
    expect(message).not.toMatch(/haven't synced/i);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Invite withdrawn.'));
  });

  // ── A locked-out member ─────────────────────────────────────────────────────────────────────

  const LOCKED = [ROWS[0], { ...ROWS[3], lockedUntil: '2026-09-08T10:15:00Z' }];

  // ⚠️ Shown BESIDE the status, not instead of it: a locked login is still a login.
  it('shows a locked member as locked on the row without hiding that they have a login', async () => {
    listLogins.mockResolvedValue(LOCKED);
    renderSection({}, LOCKED);

    expect(await within(rowOf('Robin')).findByText('Locked')).toBeInTheDocument();
    expect(within(rowOf('Robin')).getByText('Signs in as robin@example.com')).toBeInTheDocument();
  });

  it('lets the owner clear the lockout', async () => {
    listLogins.mockResolvedValue(LOCKED);
    renderSection({}, LOCKED);
    await within(rowOf('Robin')).findByText('Locked');
    fireEvent.click(within(await openSheet('Robin')).getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(unlockLogin).toHaveBeenCalledWith(4));
    expect(showToast).toHaveBeenCalledWith('Robin can try signing in again.');
  });

  it('offers no unlock control when nobody is locked out', async () => {
    renderSection();
    const sheet = await openSheet('Robin');

    expect(within(sheet).queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });

  // ── Renaming and removing a person ──────────────────────────────────────────────────────────

  it('renames a person, including the primary person', async () => {
    const refreshPeople = vi.fn().mockResolvedValue();
    renderSection({ refreshPeople });
    const sheet = await openSheet('Nate');

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: 'Nathaniel' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updatePerson).toHaveBeenCalledWith(1, 'Nathaniel'));
    expect(refreshPeople).toHaveBeenCalled();
  });

  it('refuses a blank name', async () => {
    renderSection();
    const sheet = await openSheet('Sam');

    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: '  ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    expect(await within(sheet).findByText('Enter a name.')).toBeInTheDocument();
    expect(updatePerson).not.toHaveBeenCalled();
  });

  it('offers removing a person only for someone other than the primary', async () => {
    renderSection();

    expect(within(await openSheet('Nate')).queryByRole('button', { name: /^Remove Nate$/ })).not.toBeInTheDocument();
    expect(within(await openSheet('Sam')).getByRole('button', { name: 'Remove Sam' })).toBeInTheDocument();
  });

  // ⚠️ Deleting a person is the permanent one, and its confirm must say so -- it sits in the same
  // sheet as Remove login, which deletes nothing.
  it('removes a person only after a confirm that says it is permanent', async () => {
    const refreshPeople = vi.fn().mockResolvedValue();
    renderSection({ refreshPeople });
    fireEvent.click(within(await openSheet('Robin')).getByRole('button', { name: 'Remove Robin' }));

    const [message, , options] = openConfirm.mock.calls[0];
    expect(options.title).toBe('Remove Robin?');
    expect(message).toMatch(/permanently deletes/i);
    await waitFor(() => expect(removePerson).toHaveBeenCalledWith(4));
    expect(refreshPeople).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Robin' })).not.toBeInTheDocument();
  });
});

// The owner's "Trusted" toggle -- AccountRole.MANAGER, made assignable on Plus and Pro.
describe('PeopleSection trusted logins', () => {
  const TRUST_ROWS = [
    { personId: 1, personName: 'Nate', status: 'ACTIVE', email: 'nate@example.com', isSelf: true, role: 'OWNER' },
    { personId: 2, personName: 'Jess', status: 'ACTIVE', email: 'jess@example.com', isSelf: false, role: 'MEMBER' },
    { personId: 3, personName: 'Leo', status: 'NONE', email: null, isSelf: false, role: null },
    { personId: 4, personName: 'Alex', status: 'INVITED', email: 'alex@example.com', isSelf: false, role: null },
    { personId: 5, personName: 'Mae', status: 'ACTIVE', email: 'mae@example.com', isSelf: false, role: 'MANAGER' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    listLogins.mockResolvedValue(TRUST_ROWS);
    setLoginRole.mockResolvedValue({});
    revokeLogin.mockResolvedValue(undefined);
  });

  // The point of the merge: who is trusted reads straight off the list.
  it('marks who is trusted on the row itself', async () => {
    renderSection({ plan: 'PLUS' }, TRUST_ROWS);

    expect(await within(rowOf('Mae')).findByText('Trusted')).toBeInTheDocument();
    expect(within(rowOf('Jess')).queryByText('Trusted')).not.toBeInTheDocument();
  });

  // Only an active login that is not the owner's own can be trusted -- the server 409s the rest.
  it('offers the toggle only on active logins other than the owner', async () => {
    renderSection({ plan: 'PLUS' }, TRUST_ROWS);

    expect(within(await openSheet('Jess')).getByRole('checkbox', { name: 'Trusted: Jess' })).not.toBeChecked();
    expect(within(await openSheet('Mae')).getByRole('checkbox', { name: 'Trusted: Mae' })).toBeChecked();
    for (const name of ['Nate', 'Leo', 'Alex']) {
      expect(within(await openSheet(name)).queryByRole('checkbox')).not.toBeInTheDocument();
    }
  });

  // Named for the person it is about, so it cannot read as belonging to anyone else.
  it('says what Trusted grants, naming the person, beside the toggle', async () => {
    renderSection({ plan: 'PLUS', vocab: { account: 'household' } }, TRUST_ROWS);
    const sheet = await openSheet('Jess');

    expect(within(sheet).getByText(/Jess can log workouts for everyone in the household/i)).toBeInTheDocument();
  });

  it('asks before trusting someone, naming what it grants and what it does not', async () => {
    renderSection({ plan: 'PLUS' }, TRUST_ROWS);
    fireEvent.click(within(await openSheet('Jess')).getByRole('checkbox', { name: 'Trusted: Jess' }));

    const [message, , options] = openConfirm.mock.calls[0];
    expect(message).toMatch(/log, edit and delete workouts for everyone/i);
    expect(message).toMatch(/except you/i);
    expect(options).toEqual({ title: 'Make Jess a trusted member?', confirmLabel: 'Make trusted' });
    // The title asks the question, so the body must not ask it again.
    expect(message).not.toMatch(/\?/);
    await waitFor(() => expect(setLoginRole).toHaveBeenCalledWith(2, 'MANAGER'));
    expect(showToast).toHaveBeenCalledWith('Jess can now log for everyone.');
    await waitFor(() => expect(listLogins).toHaveBeenCalledTimes(2));
  });

  // Taking access away needs no confirmation.
  it('turns trust off without asking', async () => {
    renderSection({ plan: 'PLUS' }, TRUST_ROWS);
    fireEvent.click(within(await openSheet('Mae')).getByRole('checkbox', { name: 'Trusted: Mae' }));

    await waitFor(() => expect(setLoginRole).toHaveBeenCalledWith(5, 'MEMBER'));
    expect(openConfirm).not.toHaveBeenCalled();
  });

  // Pro keeps its own word for the same role.
  it('calls it Assistant on a trainer account', async () => {
    renderSection({ plan: 'PRO', vocab: { account: 'practice', manager: 'assistant' } }, TRUST_ROWS);
    fireEvent.click(within(await openSheet('Jess')).getByRole('checkbox', { name: 'Assistant: Jess' }));

    const [message, , options] = openConfirm.mock.calls[0];
    expect(message).toMatch(/everyone in this practice except you/i);
    expect(options).toEqual({ title: 'Make Jess an assistant?', confirmLabel: 'Make assistant' });
    expect(within(rowOf('Mae')).getByText('Assistant')).toBeInTheDocument();
  });

  it('offers no toggle on Free', async () => {
    renderSection({ plan: 'FREE' }, TRUST_ROWS);
    expect(within(await openSheet('Jess')).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  // A trusted member also reaches this list (MANAGE_PEOPLE, MANAGE_LOGINS), but only the owner may
  // trust anyone or remove a trusted login or a person -- and nobody touches the owner's login.
  describe('viewed by a trusted member', () => {
    const AS_MAE = TRUST_ROWS.map((r) => ({ ...r, isSelf: r.personId === 5 }));
    const canWritePerson = (id) => id !== 1;

    beforeEach(() => listLogins.mockResolvedValue(AS_MAE));

    it('shows who is trusted, with no toggle and no way to remove anyone', async () => {
      renderSection({ plan: 'PLUS', isOwner: false, canWritePerson }, AS_MAE);
      const sheet = await openSheet('Jess');

      expect(within(sheet).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(within(sheet).queryByRole('button', { name: 'Remove Jess' })).not.toBeInTheDocument();
      expect(within(rowOf('Mae')).getByText('Trusted')).toBeInTheDocument();
    });

    // Nothing on the owner's row is theirs to change, so it is a plain row, not a button.
    it("gives the owner's row no sheet", async () => {
      renderSection({ plan: 'PLUS', isOwner: false, canWritePerson }, AS_MAE);
      await screen.findByText('Signs in as nate@example.com');

      expect(screen.queryByRole('button', { name: 'Edit Nate' })).not.toBeInTheDocument();
      expect(screen.getByTestId('person-row-1')).toHaveTextContent('Nate');
    });

    it('offers Remove login only where the server would allow it', async () => {
      const rows = [
        ...AS_MAE,
        { personId: 6, personName: 'Kit', status: 'ACTIVE', email: 'kit@example.com', isSelf: false, role: 'MANAGER' },
      ];
      listLogins.mockResolvedValue(rows);
      renderSection({ plan: 'PLUS', isOwner: false, canWritePerson }, rows);

      // Jess (a member) and Alex (an invitation) -- not Mae (self) or Kit (trusted).
      expect(within(await openSheet('Jess')).getByRole('button', { name: 'Remove login' })).toBeInTheDocument();
      expect(within(await openSheet('Alex')).getByRole('button', { name: 'Withdraw invite' })).toBeInTheDocument();
      expect(within(await openSheet('Mae')).queryByRole('button', { name: 'Remove login' })).not.toBeInTheDocument();
      expect(within(await openSheet('Kit')).queryByRole('button', { name: 'Remove login' })).not.toBeInTheDocument();
    });
  });
});
