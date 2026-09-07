import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginsSection from './LoginsSection';
import { listLogins, inviteLogin } from '../../api/logins';

vi.mock('../../api/logins', () => ({ listLogins: vi.fn(), inviteLogin: vi.fn() }));

const showToast = vi.fn();
vi.mock('../../context/UIContext', () => ({ useUI: () => ({ showToast }) }));

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
  { personId: 1, personName: 'Nate', status: 'ACTIVE', email: 'nate@example.com' },
  { personId: 2, personName: 'Sam', status: 'NONE', email: null },
  { personId: 3, personName: 'Alex', status: 'INVITED', email: 'alex@example.com' },
];

describe('LoginsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLogins.mockResolvedValue(ROWS);
    inviteLogin.mockResolvedValue({});
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows each person with their login state', async () => {
    render(<LoginsSection />);

    expect(await screen.findByText('Nate')).toBeInTheDocument();
    expect(screen.getByText('HAS LOGIN')).toBeInTheDocument();
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
});
