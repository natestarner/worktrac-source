import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BillingTab from './BillingTab';
import PlanBadge from './PlanBadge';
import PlusUpsell from '../shared/PlusUpsell';
import HistoryWindowModal from '../shared/HistoryWindowModal';
import { renderWithQuery } from '../../test/queryWrapper';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useBillingChannel } from '../../hooks/useBillingChannel';
import { openExternal, openInBrowser } from '../../lib/native';
import { readPendingCheckout } from '../../lib/pendingCheckout';
import {
  createCheckoutLink,
  createCheckoutSession,
  createPortalSession,
  getSubscription,
} from '../../api/billing';

// Every surface that leads toward a purchase, under each of the three billing channels
// (lib/native/billingChannel.js). 'embedded' is the web and is covered by each component's own
// tests unchanged; this file pins what the App Store app may and may not show.
vi.mock('../../hooks/useBillingChannel', () => ({ useBillingChannel: vi.fn() }));
vi.mock('../../lib/native', async (importOriginal) => ({
  ...(await importOriginal()),
  openExternal: vi.fn().mockResolvedValue(undefined),
  openInBrowser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../api/billing', () => ({
  getSubscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  createCheckoutLink: vi.fn(),
  createPortalSession: vi.fn(),
  reconcileCheckout: vi.fn(),
}));
vi.mock('./EmbeddedCheckout', () => ({ default: () => <div data-testid="stripe-embedded-checkout" /> }));
vi.mock('../../api/logins', () => ({ listLogins: vi.fn().mockResolvedValue([]) }));

const OWNER = { accountRole: 'OWNER', personId: 1, status: 'ACTIVE' };

function renderBilling(account, subscription = null) {
  useAuth.mockReturnValue({ account, refreshPeople: vi.fn().mockResolvedValue(), membership: OWNER });
  getSubscription.mockResolvedValue(subscription);
  return renderWithQuery(
    <MemoryRouter>
      <BillingTab />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  onlineManager.setOnline(true);
  useUI.mockReturnValue({ releaseOnboarding: vi.fn(), showToast: vi.fn() });
});

describe("'none' -- the App Store app outside the US storefront", () => {
  beforeEach(() => useBillingChannel.mockReturnValue('none'));

  it('the billing screen shows the plan, and no price, purchase or upgrade of any kind', async () => {
    renderBilling({ id: 1, plan: 'FREE' });
    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade to Plus' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to logging' })).toBeInTheDocument();
  });

  it('a paying household sees its plan, with no portal link and no upgrade to Pro', async () => {
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE' });
    await waitFor(() => expect(getSubscription).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Training clients/)).not.toBeInTheDocument();
  });

  it('the header shows no "Go Plus" badge to a Free household', () => {
    useAuth.mockReturnValue({ account: { plan: 'FREE' } });
    rtlRender(
      <MemoryRouter>
        <PlanBadge />
      </MemoryRouter>
    );
    expect(screen.queryByRole('link', { name: 'Go Plus' })).not.toBeInTheDocument();
  });

  // The sentence is a fact about the person's own data; only the way to buy goes.
  it('an upsell keeps its sentence but loses its link', () => {
    rtlRender(
      <MemoryRouter>
        <PlusUpsell plan="FREE">Your full history has 47 more workouts.</PlusUpsell>
      </MemoryRouter>
    );
    expect(screen.getByText('Your full history has 47 more workouts.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See Plus' })).not.toBeInTheDocument();
  });

  it('the history explainer keeps its explanation but offers nothing to buy', () => {
    rtlRender(
      <MemoryRouter>
        <HistoryWindowModal
          historyWindow={{ windowStart: '2026-07-23T00:00:00Z', hiddenSessions: 3, earliestHiddenAt: '2026-01-01T00:00:00Z' }}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: 'Unlock full history' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How Free and Plus differ' })).toBeInTheDocument();
  });
});

describe("'external' -- the App Store app on the US storefront", () => {
  beforeEach(() => useBillingChannel.mockReturnValue('external'));

  it('Upgrade opens Stripe\'s hosted page in the browser, remembering the session to confirm on return', async () => {
    createCheckoutLink.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_1', sessionId: 'cs_1' });
    renderBilling({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));

    // Safari, not the in-app sheet: closing a sheet never backgrounds the app, so the return that
    // confirms the payment (useCheckoutResume's visibilitychange) would never fire.
    await waitFor(() => expect(openInBrowser).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1'));
    expect(openExternal).not.toHaveBeenCalled();
    expect(createCheckoutLink).toHaveBeenCalledWith('YEAR', { plan: 'PLUS', band: null });
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(readPendingCheckout()).toBe('cs_1');
    // Never the embedded form: Apple allows no payment UI inside the app.
    expect(screen.queryByTestId('stripe-embedded-checkout')).not.toBeInTheDocument();
  });

  it('Manage billing opens the Customer Portal outside the app, returning to a page that says to close it', async () => {
    createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/p/session_1' });
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Manage billing' }));

    await waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith('https://billing.stripe.com/p/session_1', expect.any(Object)),
    );
    // In the sheet, /app/billing would be a signed-out web app; /billing-done says to close the sheet.
    expect(createPortalSession).toHaveBeenCalledWith({ returnTo: 'app' });
  });

  // Closing the sheet never backgrounds the app, so nothing else would notice a cancellation or a
  // plan change made there: the billing screen would keep showing the plan as it was.
  it('closing the portal refreshes the plan and the subscription', async () => {
    createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/p/session_1' });
    const view = renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE' });
    const { refreshPeople } = useAuth.mock.results.at(-1).value;

    fireEvent.click(await screen.findByRole('button', { name: 'Manage billing' }));
    await waitFor(() => expect(openExternal).toHaveBeenCalled());
    const fetchesBefore = getSubscription.mock.calls.length;
    expect(refreshPeople).not.toHaveBeenCalled();

    const { onClose } = openExternal.mock.calls[0][1];
    onClose();

    expect(refreshPeople).toHaveBeenCalled();
    await waitFor(() => expect(getSubscription.mock.calls.length).toBeGreaterThan(fetchesBefore));
    view.unmount();
  });
});

describe("'embedded' -- the web, unchanged", () => {
  beforeEach(() => useBillingChannel.mockReturnValue('embedded'));

  it('Upgrade still mounts the embedded checkout and never calls the link endpoint', async () => {
    createCheckoutSession.mockResolvedValue({ clientSecret: 'cs_secret', publishableKey: 'pk_test' });
    renderBilling({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));

    expect(await screen.findByTestId('stripe-embedded-checkout')).toBeInTheDocument();
    expect(createCheckoutLink).not.toHaveBeenCalled();
    expect(readPendingCheckout()).toBeNull();
  });

  it('Manage billing asks for the portal exactly as before, returning to the billing screen', async () => {
    createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/p/session_1' });
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Manage billing' }));

    await waitFor(() => expect(openExternal).toHaveBeenCalled());
    expect(createPortalSession).toHaveBeenCalledWith({ returnTo: undefined });
  });
});
