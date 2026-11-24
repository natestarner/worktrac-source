import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BillingTab from './BillingTab';
import PlanBadge from './PlanBadge';
import PlusUpsell from '../shared/PlusUpsell';
import HistoryWindowModal from '../shared/HistoryWindowModal';
import PeopleSection from '../profile/PeopleSection';
import { listLogins } from '../../api/logins';
import { renderWithQuery } from '../../test/queryWrapper';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useBillingChannel } from '../../hooks/useBillingChannel';
import {
  finish,
  getProducts,
  manageSubscriptions,
  openExternal,
  purchase,
  requestRefund,
  restore,
} from '../../lib/native';
import {
  createCheckoutSession,
  createPortalSession,
  getStoreProducts,
  getSubscription,
  prepareStorePurchase,
  releaseStorePurchase,
  syncStorePurchases,
} from '../../api/billing';

// Every surface that leads toward a purchase, under each of the three billing channels
// (lib/native/billingChannel.js): 'embedded' (the web), 'store' (In-App Purchase in the App Store
// app) and 'none' (an app with no store). This file pins what each may and may not show.
vi.mock('../../hooks/useBillingChannel', () => ({ useBillingChannel: vi.fn() }));
vi.mock('../../lib/native', async (importOriginal) => ({
  ...(await importOriginal()),
  openExternal: vi.fn().mockResolvedValue(undefined),
  openInBrowser: vi.fn().mockResolvedValue(undefined),
  // The App Store app's store: lib/native/purchases.js, which talks to the StoreKit plugin.
  storeSource: () => 'app-store',
  storeBillingSource: () => 'APP_STORE',
  getProducts: vi.fn(),
  purchase: vi.fn(),
  restore: vi.fn(),
  finish: vi.fn().mockResolvedValue(undefined),
  manageSubscriptions: vi.fn().mockResolvedValue({ result: 'shown' }),
  requestRefund: vi.fn(),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../api/billing', () => ({
  getSubscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  reconcileCheckout: vi.fn(),
  getStoreProducts: vi.fn(),
  prepareStorePurchase: vi.fn(),
  releaseStorePurchase: vi.fn().mockResolvedValue(undefined),
  syncStorePurchases: vi.fn(),
}));
vi.mock('./EmbeddedCheckout', () => ({ default: () => <div data-testid="stripe-embedded-checkout" /> }));
vi.mock('../../api/logins', () => ({ listLogins: vi.fn().mockResolvedValue([]) }));

const OWNER = { accountRole: 'OWNER', personId: 1, status: 'ACTIVE' };

// A person with no login yet: on Free, the row is where a household meets "logins are part of Plus".
const LOGIN_ROWS = [
  { personId: 1, personName: 'Nate', status: 'ACTIVE', email: 'nate@example.com', isSelf: true },
  { personId: 2, personName: 'Sam', status: 'NONE', email: null, isSelf: false },
];

function renderBilling(account, subscription = null, path = '/app/billing') {
  useAuth.mockReturnValue({ account, refreshPeople: vi.fn().mockResolvedValue(), membership: OWNER });
  getSubscription.mockResolvedValue(subscription);
  return renderWithQuery(
    <MemoryRouter initialEntries={[path]}>
      <BillingTab />
    </MemoryRouter>
  );
}

let showToast;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  onlineManager.setOnline(true);
  showToast = vi.fn();
  useUI.mockReturnValue({ releaseOnboarding: vi.fn(), showToast });
});

describe("'none' -- an app with no store plugin", () => {
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

  it('the logins list says a login is part of Plus, and links nowhere', async () => {
    listLogins.mockResolvedValue(LOGIN_ROWS);
    renderWithQuery(
      <MemoryRouter>
        <PeopleSection plan="FREE" people={LOGIN_ROWS.map((r) => ({ id: r.personId, name: r.personName }))} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Logins for other people are part of Plus.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Unlock with Plus' })).not.toBeInTheDocument();
  });
});

// What the backend sells here, and what the store prices it at -- deliberately not the web's prices,
// so a test can tell which one the screen is showing.
const OFFERED = [
  { plan: 'PLUS', band: null, interval: 'YEAR', productId: 'huddle.plus.year' },
  { plan: 'PLUS', band: null, interval: 'MONTH', productId: 'huddle.plus.month' },
  { plan: 'PRO', band: 'STARTER', interval: 'YEAR', productId: 'huddle.pro.starter.year' },
];
const STORE_PRICES = [
  { id: 'huddle.plus.year', displayPrice: '$29.99' },
  { id: 'huddle.plus.month', displayPrice: '$3.99' },
  { id: 'huddle.pro.starter.year', displayPrice: '$189.99' },
];
const PURCHASED = { result: 'purchased', proof: 'jws.signed.tx', transactionId: '2000000123' };

describe("'store' -- In-App Purchase in the App Store app", () => {
  beforeEach(() => {
    useBillingChannel.mockReturnValue('store');
    getStoreProducts.mockResolvedValue(OFFERED);
    getProducts.mockResolvedValue(STORE_PRICES);
  });

  it("shows the store's own prices, the renewal terms and Restore purchases", async () => {
    renderBilling({ id: 1, plan: 'FREE' });
    expect(await screen.findByText('Yearly: $29.99 / year')).toBeInTheDocument();
    expect(screen.getByText('Monthly: $3.99 / month')).toBeInTheDocument();
    // The web's prices and its savings arithmetic are not shown: the store's points differ.
    expect(screen.queryByText(/\$29 \/ year/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Save 39%/)).not.toBeInTheDocument();
    expect(screen.getByText('$189.99 / year')).toBeInTheDocument();
    expect(screen.getByText(/renews automatically unless you cancel it at least 24 hours/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore purchases' })).toBeInTheDocument();
    expect(getProducts).toHaveBeenCalledWith(OFFERED.map((p) => p.productId));
  });

  it('buys through the store with the household token, confirms with the backend, then finishes', async () => {
    prepareStorePurchase.mockResolvedValue({ productId: 'huddle.plus.year', accountToken: 'token-1' });
    purchase.mockResolvedValue(PURCHASED);
    syncStorePurchases.mockResolvedValue({ plan: 'PLUS', billingSource: 'APP_STORE' });
    renderBilling({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));

    await waitFor(() => expect(finish).toHaveBeenCalledWith('2000000123'));
    expect(prepareStorePurchase).toHaveBeenCalledWith('app-store', { plan: 'PLUS', band: null, interval: 'YEAR' });
    expect(purchase).toHaveBeenCalledWith({ productId: 'huddle.plus.year', accountToken: 'token-1' });
    expect(syncStorePurchases).toHaveBeenCalledWith('app-store', [PURCHASED]);
    // Finished only AFTER the backend had it.
    expect(syncStorePurchases.mock.invocationCallOrder[0]).toBeLessThan(finish.mock.invocationCallOrder[0]);
    // Never Stripe, in any form.
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId('stripe-embedded-checkout')).not.toBeInTheDocument();
  });

  // The store's queue is the retry: an unconfirmed purchase is left unfinished and sent again later.
  it('does not finish a purchase the backend could not confirm', async () => {
    prepareStorePurchase.mockResolvedValue({ productId: 'huddle.plus.year', accountToken: 'token-1' });
    purchase.mockResolvedValue(PURCHASED);
    syncStorePurchases.mockRejectedValue(new Error('503'));
    renderBilling({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Purchase received. Your plan will update shortly.', { tone: 'info' }),
    );
    expect(finish).not.toHaveBeenCalled();
  });

  it('a cancelled sheet releases the purchase claim and confirms nothing', async () => {
    prepareStorePurchase.mockResolvedValue({ productId: 'huddle.plus.year', accountToken: 'token-1' });
    purchase.mockResolvedValue({ result: 'cancelled' });
    renderBilling({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));

    await waitFor(() => expect(releaseStorePurchase).toHaveBeenCalledWith('app-store'));
    expect(syncStorePurchases).not.toHaveBeenCalled();
  });

  it('Ask to Buy says it is waiting, and confirms nothing yet', async () => {
    prepareStorePurchase.mockResolvedValue({ productId: 'huddle.plus.year', accountToken: 'token-1' });
    purchase.mockResolvedValue({ result: 'pending' });
    renderBilling({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/Waiting for approval/), expect.anything()));
    expect(syncStorePurchases).not.toHaveBeenCalled();
  });

  // The server's refusal is written for people ("billed on huddle.fitness", "another device").
  it("shows the server's reason when the purchase is refused", async () => {
    prepareStorePurchase.mockRejectedValue(
      Object.assign(new Error('A purchase is already in progress on another device.'), { status: 409 }),
    );
    renderBilling({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('A purchase is already in progress on another device.', { tone: 'error' }),
    );
    expect(purchase).not.toHaveBeenCalled();
  });

  // Fails closed: no prices from the store, nothing to buy.
  it('offers nothing to buy when the store cannot price the plans', async () => {
    getProducts.mockRejectedValue(new Error('StoreKit unavailable'));
    renderBilling({ id: 1, plan: 'FREE' });

    expect(await screen.findByText(/Plans couldn't be loaded from the store/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade to Plus' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('Restore purchases re-sends what the store holds and finishes it', async () => {
    restore.mockResolvedValue([PURCHASED]);
    syncStorePurchases.mockResolvedValue({ plan: 'PLUS', billingSource: 'APP_STORE' });
    renderBilling({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Restore purchases' }));

    await waitFor(() => expect(finish).toHaveBeenCalledWith('2000000123'));
    expect(syncStorePurchases).toHaveBeenCalledWith('app-store', [PURCHASED]);
  });

  it('a household paying through the App Store manages it in the store, and is offered no Pro checkout', async () => {
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE', billingSource: 'APP_STORE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }));

    await waitFor(() => expect(manageSubscriptions).toHaveBeenCalled());
    expect(screen.getByText('Billed through the App Store.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Training clients/)).not.toBeInTheDocument();
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  // Apple: on an iPad app running on a Mac, don't show the manage sheet; say where instead.
  it('Manage subscription on a Mac says where to manage it instead', async () => {
    manageSubscriptions.mockResolvedValueOnce({ result: 'unavailable' });
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE', billingSource: 'APP_STORE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/App Store app/), expect.anything()));
  });

  it("Request a refund opens Apple's own sheet and says Apple will answer", async () => {
    requestRefund.mockResolvedValue({ result: 'requested' });
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE', billingSource: 'APP_STORE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Request a refund' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Request sent. Apple will email you its decision.', { tone: 'info' }),
    );
    // Nothing about the plan changes here: a granted refund arrives as Apple's notification.
    expect(syncStorePurchases).not.toHaveBeenCalled();
  });

  it('Request a refund on an Apple ID that holds no subscription says to use the device that bought it', async () => {
    requestRefund.mockResolvedValue({ result: 'none' });
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE', billingSource: 'APP_STORE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Request a refund' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/device that bought it/), expect.anything()));
  });

  // "Subscribe" on the App Store page (Apple's PurchaseIntent) lands here as ?buy=<productId> and is
  // completed through the ordinary flow, so it carries the household token.
  it('completes a purchase started on the App Store page, for the product chosen there', async () => {
    prepareStorePurchase.mockResolvedValue({ productId: 'huddle.pro.starter.year', accountToken: 'token-1' });
    purchase.mockResolvedValue(PURCHASED);
    syncStorePurchases.mockResolvedValue({ plan: 'PRO', billingSource: 'APP_STORE' });
    renderBilling({ id: 1, plan: 'FREE' }, null, '/app/billing?buy=huddle.pro.starter.year');

    await waitFor(() => expect(finish).toHaveBeenCalledWith('2000000123'));
    expect(prepareStorePurchase).toHaveBeenCalledWith('app-store', { plan: 'PRO', band: 'STARTER', interval: 'YEAR' });
    expect(purchase).toHaveBeenCalledWith({ productId: 'huddle.pro.starter.year', accountToken: 'token-1' });
    expect(prepareStorePurchase).toHaveBeenCalledTimes(1);
  });

  it('a product the store does not offer here says so and buys nothing', async () => {
    renderBilling({ id: 1, plan: 'FREE' }, null, '/app/billing?buy=huddle.team.year');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("That plan isn't available here right now.", expect.anything()));
    expect(prepareStorePurchase).not.toHaveBeenCalled();
  });

  // Rule 1: one source per household, and no link out of the app.
  it('a household paying on the web is told where, with no control and no link', async () => {
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE', billingSource: 'STRIPE' });

    expect(
      await screen.findByText('Your plan is billed on huddle.fitness. Sign in there to change it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /huddle\.fitness/ })).not.toBeInTheDocument();
  });

  // Every other upgrade surface leads to the billing screen exactly as on the web: in the store
  // channel there IS somewhere to buy, so nothing is hidden. Each surface only asks "is it 'none'?".
  it('the header offers "Go Plus" to a Free household, leading to Billing', () => {
    useAuth.mockReturnValue({ account: { plan: 'FREE' } });
    rtlRender(
      <MemoryRouter>
        <PlanBadge />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Go Plus' })).toHaveAttribute('href', '/app/billing');
  });

  it('an upsell keeps its sentence and its "See Plus" link', () => {
    rtlRender(
      <MemoryRouter>
        <PlusUpsell plan="FREE">Your full history has 47 more workouts.</PlusUpsell>
      </MemoryRouter>
    );
    expect(screen.getByText('Your full history has 47 more workouts.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See Plus' })).toBeInTheDocument();
  });

  it('the history explainer offers "Unlock full history"', () => {
    rtlRender(
      <MemoryRouter>
        <HistoryWindowModal
          historyWindow={{ windowStart: '2026-07-23T00:00:00Z', hiddenSessions: 3, earliestHiddenAt: '2026-01-01T00:00:00Z' }}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'Unlock full history' })).toBeInTheDocument();
  });

  it('the logins list offers "Unlock with Plus", leading to Billing', async () => {
    listLogins.mockResolvedValue(LOGIN_ROWS);
    renderWithQuery(
      <MemoryRouter>
        <PeopleSection plan="FREE" people={LOGIN_ROWS.map((r) => ({ id: r.personId, name: r.personName }))} />
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: 'Unlock with Plus' });
    expect(link).toHaveAttribute('href', '/app/billing');
    // Once, above the list -- not repeated on every row without a login.
    expect(screen.getAllByRole('link', { name: 'Unlock with Plus' })).toHaveLength(1);
  });

  // A trainer at the band's ceiling in the App Store app: Billing sends them to the store's own
  // sheet, which lists every plan in the subscription group, rather than to a checkout of ours.
  it('a Pro household paying through the App Store changes band in the store, not here', async () => {
    renderBilling(
      { id: 1, plan: 'PRO' },
      { plan: 'PRO', status: 'ACTIVE', billingSource: 'APP_STORE', clientSeats: 5, clientCount: 5 },
    );
    expect(await screen.findByRole('button', { name: 'Manage subscription' })).toBeInTheDocument();
    expect(screen.getByText(/^Starter: 5 of 5 /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subscribe to Pro' })).not.toBeInTheDocument();
  });
});

describe("'embedded' -- the web, unchanged", () => {
  beforeEach(() => useBillingChannel.mockReturnValue('embedded'));

  it('Upgrade still mounts the embedded checkout and never calls the link endpoint', async () => {
    createCheckoutSession.mockResolvedValue({ clientSecret: 'cs_secret', publishableKey: 'pk_test' });
    renderBilling({ id: 1, plan: 'FREE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Plus' }));

    expect(await screen.findByTestId('stripe-embedded-checkout')).toBeInTheDocument();
    expect(prepareStorePurchase).not.toHaveBeenCalled();
  });

  it('Manage billing asks for the portal exactly as before, returning to the billing screen', async () => {
    createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/p/session_1' });
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE' });

    fireEvent.click(await screen.findByRole('button', { name: 'Manage billing' }));

    await waitFor(() => expect(openExternal).toHaveBeenCalled());
    expect(createPortalSession).toHaveBeenCalledWith();
  });

  // Paying through the App Store, seen on the web: the plan is changed where it is billed.
  it('a household paying through the App Store is told to manage it on the phone, with no portal', async () => {
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE', billingSource: 'APP_STORE' });

    expect(await screen.findByText(/Your plan is billed through the App Store/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage billing' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Training clients/)).not.toBeInTheDocument();
  });

  it('a Stripe household on the web still sees Manage billing and the Pro upgrade', async () => {
    renderBilling({ id: 1, plan: 'PLUS' }, { plan: 'PLUS', status: 'ACTIVE', billingSource: 'STRIPE' });
    expect(await screen.findByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
    expect(screen.getByText(/Training clients/)).toBeInTheDocument();
  });
});

// ── The Pro card's own Monthly/Yearly, in each channel that sells ─────────────────────────────
// App Review (1.3.0, 2026-11-23, guideline 2.1(b)) could not find the monthly Pro plans: the Plus
// card's radio group silently priced Pro, the screen sat on Yearly, and Pro Unlimited -- which the
// App Store sells monthly only -- was missing from the band list altogether.
describe('the Pro card chooses its own interval', () => {
  // As App Store Connect has it: every band monthly and yearly, except Unlimited, monthly only.
  const STORE_OFFERED = [
    { plan: 'PLUS', band: null, interval: 'YEAR', productId: 'huddle.plus.year' },
    { plan: 'PLUS', band: null, interval: 'MONTH', productId: 'huddle.plus.month' },
    { plan: 'PRO', band: 'STARTER', interval: 'MONTH', productId: 'huddle.pro.starter.month' },
    { plan: 'PRO', band: 'STARTER', interval: 'YEAR', productId: 'huddle.pro.starter.year' },
    { plan: 'PRO', band: 'UNLIMITED', interval: 'MONTH', productId: 'huddle.pro.unlimited.month' },
  ];
  const STORE_PRO_PRICES = [
    { id: 'huddle.plus.year', displayPrice: '$29.99' },
    { id: 'huddle.plus.month', displayPrice: '$3.99' },
    { id: 'huddle.pro.starter.month', displayPrice: '$18.99' },
    { id: 'huddle.pro.starter.year', displayPrice: '$189.99' },
    { id: 'huddle.pro.unlimited.month', displayPrice: '$148.99' },
  ];
  const bandOptions = () =>
    Array.from(screen.getByLabelText('How many clients?').querySelectorAll('option')).map((o) => o.value);

  describe("'store'", () => {
    beforeEach(() => {
      useBillingChannel.mockReturnValue('store');
      getStoreProducts.mockResolvedValue(STORE_OFFERED);
      getProducts.mockResolvedValue(STORE_PRO_PRICES);
    });

    it('opens on monthly with Unlimited listed, though the Plus card shows yearly', async () => {
      renderBilling({ id: 1, plan: 'FREE' });

      expect(await screen.findByRole('radio', { name: 'Pro monthly' })).toBeChecked();
      expect(screen.getByRole('radio', { name: /^Yearly/ })).toBeChecked();
      expect(bandOptions()).toEqual(['STARTER', 'UNLIMITED']);
      expect(screen.getByText('$18.99 / month')).toBeInTheDocument();
    });

    it('buys Unlimited monthly from the Pro card alone', async () => {
      prepareStorePurchase.mockResolvedValue({ productId: 'huddle.pro.unlimited.month', accountToken: 'token-1' });
      purchase.mockResolvedValue({ result: 'cancelled' });
      renderBilling({ id: 1, plan: 'FREE' });

      fireEvent.change(await screen.findByLabelText('How many clients?'), { target: { value: 'UNLIMITED' } });
      expect(screen.getByText('$148.99 / month')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Subscribe to Pro' }));

      await waitFor(() =>
        expect(prepareStorePurchase).toHaveBeenCalledWith('app-store', { plan: 'PRO', band: 'UNLIMITED', interval: 'MONTH' }));
    });

    // On Yearly the store has no Unlimited: the card says where it is rather than dropping it silently,
    // and going back to Monthly on the same card brings it (and the trainer's choice) back.
    it('on yearly, says Unlimited is monthly only, and monthly brings it back', async () => {
      prepareStorePurchase.mockResolvedValue({ productId: 'huddle.pro.starter.year', accountToken: 'token-1' });
      purchase.mockResolvedValue({ result: 'cancelled' });
      renderBilling({ id: 1, plan: 'FREE' });

      fireEvent.change(await screen.findByLabelText('How many clients?'), { target: { value: 'UNLIMITED' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Pro yearly' }));

      expect(bandOptions()).toEqual(['STARTER']);
      expect(screen.getByText('Unlimited is billed monthly only.')).toBeInTheDocument();
      expect(screen.getByText('$189.99 / year')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Subscribe to Pro' }));
      await waitFor(() =>
        expect(prepareStorePurchase).toHaveBeenCalledWith('app-store', { plan: 'PRO', band: 'STARTER', interval: 'YEAR' }));

      fireEvent.click(screen.getByRole('radio', { name: 'Pro monthly' }));
      expect(screen.getByLabelText('How many clients?')).toHaveValue('UNLIMITED');
      expect(screen.queryByText(/billed monthly only/)).not.toBeInTheDocument();
    });

    it("the Plus card's interval does not change Pro's", async () => {
      renderBilling({ id: 1, plan: 'FREE' });

      fireEvent.click(await screen.findByRole('radio', { name: /^Monthly/ }));
      fireEvent.click(screen.getByRole('radio', { name: /^Yearly/ }));

      expect(screen.getByRole('radio', { name: 'Pro monthly' })).toBeChecked();
      expect(bandOptions()).toEqual(['STARTER', 'UNLIMITED']);
    });

    // A store that prices Pro at one interval only has nothing to choose between: no control, and the
    // card falls to the interval that IS sold rather than to an empty card.
    it('shows no interval control when the store sells Pro at one interval only', async () => {
      getStoreProducts.mockResolvedValue(OFFERED);
      getProducts.mockResolvedValue(STORE_PRICES);
      renderBilling({ id: 1, plan: 'FREE' });

      expect(await screen.findByText('$189.99 / year')).toBeInTheDocument();
      expect(screen.queryByRole('radiogroup', { name: 'Pay monthly or yearly?' })).not.toBeInTheDocument();
    });
  });

  describe("'embedded'", () => {
    beforeEach(() => {
      useBillingChannel.mockReturnValue('embedded');
      createCheckoutSession.mockResolvedValue({ clientSecret: 'cs_secret', publishableKey: 'pk_test' });
    });

    it('lists every band at both intervals, and checks out the interval the Pro card shows', async () => {
      renderBilling({ id: 1, plan: 'FREE' });

      expect(await screen.findByRole('radio', { name: 'Pro monthly' })).toBeChecked();
      expect(bandOptions()).toEqual(['STARTER', 'STUDIO', 'PRACTICE', 'UNLIMITED']);
      fireEvent.click(screen.getByRole('radio', { name: 'Pro yearly' }));
      expect(bandOptions()).toEqual(['STARTER', 'STUDIO', 'PRACTICE', 'UNLIMITED']);
      expect(screen.queryByText(/billed monthly only/)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('How many clients?'), { target: { value: 'UNLIMITED' } });
      fireEvent.click(screen.getByRole('button', { name: 'Subscribe to Pro' }));
      await waitFor(() =>
        expect(createCheckoutSession).toHaveBeenCalledWith('YEAR', { plan: 'PRO', band: 'UNLIMITED' }));
    });
  });
});
