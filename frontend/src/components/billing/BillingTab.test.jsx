import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BillingTab from './BillingTab';
import { renderWithQuery } from '../../test/queryWrapper';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  reconcileCheckout,
} from '../../api/billing';

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

  // The fine print used to name Terms/Privacy without linking to them -- someone deciding
  // whether to pay had no way to actually read what they were agreeing to.
  it('links "Terms" and "Privacy Policy" in the fine print to the marketing site', async () => {
    render({ id: 1, plan: 'FREE' });
    await screen.findByRole('button', { name: 'Upgrade to Pro' });

    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', 'https://huddle.fitness/terms.html');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      'https://huddle.fitness/privacy.html',
    );
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

  // The moment a checkout actually lands. releaseOnboarding must wait for the celebration to be
  // dismissed -- releasing it the instant reconcile resolves would let the welcome tour stack a
  // second overlay on top of a celebration nobody asked to see behind it yet.
  it('celebrates a successful checkout, then releases onboarding only once dismissed', async () => {
    const releaseOnboarding = vi.fn();
    useUI.mockReturnValue({ releaseOnboarding, showToast: vi.fn() });
    useAuth.mockReturnValue({ account: { id: 1, plan: 'PRO' }, refreshPeople: vi.fn().mockResolvedValue() });
    getSubscription.mockResolvedValue({ plan: 'PRO', status: 'ACTIVE', pro: true });
    reconcileCheckout.mockResolvedValue({});

    renderWithQuery(
      <MemoryRouter initialEntries={['/app/billing?checkout=cs_test123']}>
        <BillingTab />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Welcome to Huddle Pro')).toBeInTheDocument();
    expect(reconcileCheckout).toHaveBeenCalledWith('cs_test123');
    expect(releaseOnboarding).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Welcome to Huddle Pro'));

    expect(releaseOnboarding).toHaveBeenCalled();
    expect(screen.queryByText('Welcome to Huddle Pro')).not.toBeInTheDocument();
  });

  // A real StrictMode double-invoke race (mount -> cleanup -> mount racing an in-flight
  // reconcileCheckout()) is what actually caused a real, confirmed local-dev bug here -- see
  // BillingTab.jsx's own comment above this effect. It is deliberately NOT covered by a test in
  // this file: measured directly that jsdom/RTL does not reproduce React's real double-invoke
  // timing for this effect no matter how the mock's promise is scheduled (tried a real
  // setTimeout-deferred mock, wrapped in <StrictMode> explicitly -- only one invocation ever
  // fired). A unit test asserting this would pass on both the buggy and the fixed code, which is
  // worse than no test, since it reads as coverage that isn't there. The real regression guard is
  // in e2e (billing.spec.ts), which runs against an actual browser and the actual dev server.

  // The webhook is the backstop for a reconcile that fails to reach the server -- this must stay
  // a delay, never a lost payment, and certainly never a celebration for a plan change that hasn't
  // actually landed yet.
  it('does not celebrate when the reconcile itself fails', async () => {
    const showToast = vi.fn();
    useUI.mockReturnValue({ releaseOnboarding: vi.fn(), showToast });
    useAuth.mockReturnValue({ account: { id: 1, plan: 'FREE' }, refreshPeople: vi.fn().mockResolvedValue() });
    getSubscription.mockResolvedValue(null);
    reconcileCheckout.mockRejectedValue(new Error('network'));

    renderWithQuery(
      <MemoryRouter initialEntries={['/app/billing?checkout=cs_test456']}>
        <BillingTab />
      </MemoryRouter>,
    );

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      'Payment received. Your plan will update shortly.',
      { tone: 'info' },
    ));
    expect(screen.queryByText('Welcome to Huddle Pro')).not.toBeInTheDocument();
  });
});
