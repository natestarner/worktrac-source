import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAccounts from './AdminAccounts';
import { listAccounts, grantComp, revokeComp } from '../../api/admin';
import { useUI } from '../../context/UIContext';

vi.mock('../../api/admin', () => ({
  listAccounts: vi.fn(),
  grantComp: vi.fn(),
  revokeComp: vi.fn(),
}));

vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

function account(overrides = {}) {
  return {
    id: 1,
    name: 'The Starners',
    primaryPersonName: 'Nate',
    userEmail: 'nate@example.com',
    role: 'USER',
    defaultUnit: 'lb',
    createdAt: '2026-01-01T00:00:00Z',
    peopleCount: 3,
    loginCount: 1,
    sessionCount: 10,
    setCount: 100,
    lastActivityAt: '2026-09-01T00:00:00Z',
    plan: 'FREE',
    subscriptionStatus: 'FREE',
    billingInterval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    comped: false,
    compNote: null,
    compGrantable: true,
    clientSeats: null,
    stripeCustomerId: null,
    ...overrides,
  };
}

// Runs the confirm callback immediately, so a test can assert what the action DID rather than only
// that a dialog was requested.
let confirmMessage = '';
function immediateConfirm() {
  return {
    openConfirm: vi.fn((message, onConfirm) => {
      confirmMessage = message;
      return onConfirm();
    }),
    showToast: vi.fn(),
  };
}

describe('AdminAccounts plan grants', () => {
  beforeEach(() => {
    confirmMessage = '';
    vi.clearAllMocks();
    useUI.mockReturnValue(immediateConfirm());
    grantComp.mockResolvedValue(undefined);
    revokeComp.mockResolvedValue(undefined);
  });

  async function renderWith(row) {
    listAccounts.mockResolvedValue([row]);
    render(<AdminAccounts />);
    await screen.findByText('The Starners');
  }

  it('grants Plus with no band, because a household tier has no seats', async () => {
    await renderWith(account());

    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grant plan' }));

    await waitFor(() =>
      expect(grantComp).toHaveBeenCalledWith(1, { plan: 'PLUS', band: null, note: '' }),
    );
  });

  // The band selector is ABSENT rather than disabled for a household tier: sending a band with
  // Plus is a 400, so there is nothing to choose rather than something to grey out.
  it('offers a client band only for Pro, and sends it', async () => {
    await renderWith(account());
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));

    expect(screen.queryByLabelText(/client band/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/^plan$/i), { target: { value: 'PRO' } });
    fireEvent.change(screen.getByLabelText(/client band/i), { target: { value: 'PRACTICE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant plan' }));

    await waitFor(() =>
      expect(grantComp).toHaveBeenCalledWith(1, { plan: 'PRO', band: 'PRACTICE', note: '' }),
    );
  });

  // A control the server will refuse must not be offered. `compGrantable` is the server's own
  // answer, not a rule re-derived here.
  it('does not offer a grant to a household paying through Stripe', async () => {
    await renderWith(account({ compGrantable: false, stripeCustomerId: 'cus_123' }));

    const button = screen.getByRole('button', { name: 'Change plan' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/stripe/i);
  });

  // ...but a comped household with a Stripe row beside it must still be reachable, or the grant
  // could never be taken back.
  it('still opens for a comped household even when a grant would be refused', async () => {
    await renderWith(account({ comped: true, plan: 'PLUS', compGrantable: false }));

    const row = screen.getByRole('button', { name: 'Change plan' });
    expect(row).toBeEnabled();
    fireEvent.click(row);

    expect(screen.getByRole('button', { name: 'Update grant' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove grant' })).toBeEnabled();
  });

  // ⚠️ Regression guard. The form used to open on Starter for every Pro household, so an admin
  // editing only the note and pressing Update silently rewrote a Practice band (40) down to 5.
  // A band is a ceiling on adding rather than a revocation, so nothing visibly broke -- it just
  // refused their next client, for a reason nobody could have traced back to this screen.
  it('opens on the band the household actually has, not the first one', async () => {
    await renderWith(account({ comped: true, plan: 'PRO', clientSeats: 40, compNote: 'trainer' }));

    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    expect(screen.getByLabelText(/client band/i)).toHaveValue('PRACTICE');

    // Updating only the note must leave the band exactly where it was.
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'trainer, renewed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update grant' }));

    await waitFor(() =>
      expect(grantComp).toHaveBeenCalledWith(1, {
        plan: 'PRO',
        band: 'PRACTICE',
        note: 'trainer, renewed',
      }),
    );
  });

  it('reads the unlimited band back from a null ceiling', async () => {
    await renderWith(account({ comped: true, plan: 'PRO', clientSeats: null }));

    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    expect(screen.getByLabelText(/client band/i)).toHaveValue('UNLIMITED');
  });

  it('removing a grant warns that member logins pause, and that nothing is deleted', async () => {
    await renderWith(account({ comped: true, plan: 'PLUS', compNote: 'Founding household' }));

    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove grant' }));

    await waitFor(() => expect(revokeComp).toHaveBeenCalledWith(1));
    expect(confirmMessage).toMatch(/pause/i);
    expect(confirmMessage).toMatch(/no workouts are deleted/i);
  });

  it('shows the reason a household was comped', async () => {
    await renderWith(account({ comped: true, plan: 'PLUS', compNote: 'Founding household' }));

    expect(screen.getByTitle(/Founding household/)).toBeInTheDocument();
  });

  // A gated write with no outbox behind it: if it fails, saying so is the only option left.
  it('surfaces the server refusal instead of failing silently', async () => {
    await renderWith(account());
    grantComp.mockRejectedValue(new Error('This household is paying through Stripe.'));

    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grant plan' }));

    expect(await screen.findByText(/paying through Stripe/i)).toBeInTheDocument();
  });
});
