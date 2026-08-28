import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BillingTab from './BillingTab';
import { renderWithQuery } from '../../test/queryWrapper';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { createCheckoutSession, createPortalSession, getSubscription } from '../../api/billing';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../api/billing', () => ({
  getSubscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  reconcileCheckout: vi.fn(),
}));
// Stripe.js is loaded lazily inside EmbeddedCheckout and would reach for the network; the mount
// itself is covered by e2e, where a real iframe can exist.
vi.mock('./EmbeddedCheckout', () => ({
  default: () => <div data-testid="stripe-embedded-checkout" />,
}));

function render(account, subscription) {
  useAuth.mockReturnValue({ account, refreshPeople: vi.fn().mockResolvedValue() });
  getSubscription.mockResolvedValue(subscription ?? null);
  return renderWithQuery(
    <MemoryRouter>
      <BillingTab />
    </MemoryRouter>,
  );
}

describe('BillingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useUI.mockReturnValue({ releaseOnboarding: vi.fn(), showToast: vi.fn() });
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('offers the upgrade with yearly preselected on a Free household', async () => {
    render({ id: 1, plan: 'FREE' });

    expect(await screen.findByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
    // Yearly leads because the marketing pricing card headlines $29/year -- the price must not
    // change shape between the page they just read and the screen they pay on.
    expect(screen.getByRole('radio', { name: /Yearly/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Monthly/ })).not.toBeChecked();
  });

  // Free is permanent, so deferring costs nothing -- this is an equal-weight escape, not fine
  // print, especially for someone routed here straight from marketing's "Go Pro".
  it('offers a way to stay on Free', async () => {
    render({ id: 1, plan: 'FREE' });

    expect(await screen.findByRole('button', { name: /Start with Free/ })).toBeInTheDocument();
  });

  // Midday UTC, not midnight: dates render in the VIEWER's local time (see utils/datetime.js),
  // so a midnight-UTC instant is the previous day for anyone west of Greenwich and this assertion
  // would pass or fail depending on who ran it. Midday is the same local date everywhere anyone
  // will realistically run these tests.
  it('shows the renewal date for an active Pro household', async () => {
    render(
      { id: 1, plan: 'PRO' },
      { plan: 'PRO', status: 'ACTIVE', pro: true, currentPeriodEnd: '2026-09-27T12:00:00Z' },
    );

    expect(await screen.findByText(/Renews Sep 27, 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).not.toBeInTheDocument();
  });

  // The reassurance that makes cancelling non-frightening: they keep everything through the
  // period they already paid for.
  it('says "until", not "renews", once a subscription is cancelling', async () => {
    render(
      { id: 1, plan: 'PRO' },
      {
        plan: 'PRO',
        status: 'CANCELED',
        pro: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-09-27T12:00:00Z',
      },
    );

    expect(await screen.findByText(/Pro until Sep 27, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/you keep everything until then/)).toBeInTheDocument();
  });

  // Access continues through Stripe's retry window, so this is a nudge to fix the card rather
  // than a lockout -- cutting access mid-dunning turns a recoverable failure into a cancellation.
  it('nudges a past-due household without taking Pro away', async () => {
    render({ id: 1, plan: 'PRO' }, { plan: 'PRO', status: 'PAST_DUE', pro: true });

    expect(await screen.findByText(/couldn.t take your last payment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
  });

  it('tells a comped household it is on the house, with nothing to manage', async () => {
    render({ id: 1, plan: 'PRO' }, { plan: 'PRO', status: 'FREE', pro: true, comped: true });

    expect(await screen.findByText(/on the house/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument();
  });

  // THE degraded case. The plan comes from the auth snapshot, which is present on a cold offline
  // boot -- so an unreachable server must never make a paying household look Free.
  it('still shows Pro when the subscription request fails', async () => {
    useAuth.mockReturnValue({ account: { id: 1, plan: 'PRO' }, refreshPeople: vi.fn() });
    getSubscription.mockRejectedValue(new Error('network'));

    renderWithQuery(
      <MemoryRouter>
        <BillingTab />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Huddle Pro')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).not.toBeInTheDocument();
  });

  // Tier-3: a payment is not idempotent, so it must be refused up front rather than queued.
  it('disables the upgrade offline and never reaches the network', async () => {
    render({ id: 1, plan: 'FREE' });
    const upgrade = await screen.findByRole('button', { name: 'Upgrade to Pro' });

    onlineManager.setOnline(false);

    await waitFor(() => expect(upgrade).toBeDisabled());
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('opens the Stripe portal in a new tab rather than navigating away', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/test' });
    render({ id: 1, plan: 'PRO' }, { plan: 'PRO', status: 'ACTIVE', pro: true });

    fireEvent.click(await screen.findByRole('button', { name: 'Manage billing' }));

    // A navigation would hand an installed PWA's session to Safari with no reliable way back.
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        'https://billing.stripe.com/session/test',
        '_blank',
        'noopener,noreferrer',
      ),
    );
    open.mockRestore();
  });

  it('mounts Stripe checkout once a session is created', async () => {
    createCheckoutSession.mockResolvedValue({ clientSecret: 'cs_secret', publishableKey: 'pk_test' });
    render({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));

    expect(await screen.findByTestId('stripe-embedded-checkout')).toBeInTheDocument();
    expect(createCheckoutSession).toHaveBeenCalledWith('YEAR');
  });
});
