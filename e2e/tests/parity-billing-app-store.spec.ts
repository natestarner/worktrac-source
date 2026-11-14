import { expect, test } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { forEachConnectivityMode } from './support/parity';

// A household that pays through the App Store, seen on the WEB (docs/in-app-purchase-plan.md).
// One household, one billing source: its plan is managed where it was bought, so the web offers no
// Stripe portal and no checkout -- only a sentence saying where. Same plan, same screen, in every
// connectivity mode: the entitlement comes from the auth snapshot and the billing source from the
// cached subscription, so nothing here depends on a request succeeding.
//
// The App Store app's own screens (buying, Restore, Manage subscription) need StoreKit and are
// covered by billingChannels.test.jsx with the store mocked, and on a device in Phase 3.

async function openAccountMenu(page) {
  await page.locator('.header-bar').getByRole('button').click();
}

async function openBilling(page) {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Plan & billing' }).click();
}

forEachConnectivityMode<{ email: string }>('an App Store household reads as billed through the App Store', {
  setup: async (page, request) => {
    const email = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, email, 'PLUS', undefined, 'APP_STORE');
    await page.reload();
    // Visit Billing once while online, the way the household's own device would have, so the
    // subscription (and with it the billing source) is in the cache the degraded modes read.
    await openBilling(page);
    await expect(page.getByText(/billed through the App Store/)).toBeVisible();
    await page.goBack();
    return { email };
  },
  navigate: openBilling,
  act: async () => {},
  assert: async (page) => {
    await expect(page.getByText('Huddle Plus')).toBeVisible();
    await expect(page.getByText(/Your plan is billed through the App Store/)).toBeVisible();
    // No Stripe control of any kind for a plan Stripe does not bill.
    await expect(page.getByRole('button', { name: 'Manage billing' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upgrade to Plus' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Subscribe to Pro' })).toHaveCount(0);
  },
});

// Rule 1 at the API: the web checkout refuses a household the App Store is billing, so no route
// exists to a second subscription. Online only -- "refuses" is the server's answer.
test('the web checkout refuses a household the App Store is billing', async ({ page, request }) => {
  const email = await registerHousehold(page, request, 'Nate');
  await setBillingPlan(request, email, 'PLUS', undefined, 'APP_STORE');
  const status = await page.evaluate(async () => {
    const { apiUrl } = await (await fetch('/config.json')).json();
    const token = localStorage.getItem('workout-tracker-token');
    const response = await fetch(`${apiUrl}/api/billing/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: 'PLUS', interval: 'YEAR' }),
    });
    return response.status;
  });
  // 403 when billing is configured (already entitled); 503 when this environment has no Stripe at
  // all. Either way, never a checkout.
  expect([403, 503]).toContain(status);
});
