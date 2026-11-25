import { expect, test, type Page } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { forEachConnectivityMode } from './support/parity';

// The Pro card chooses its OWN billing period.
//
// It used to be priced by the Plus card's Monthly/Yearly radio group, with nothing on the Pro card
// saying so. App Review (1.3.0, 2026-11-23, guideline 2.1(b)) could not find the monthly Pro
// subscriptions because the screen sat on Yearly; Pro Unlimited, sold monthly only in the App
// Store, disappeared outright. The App Store channel's half (Unlimited monthly only) is pinned in
// billingChannels.test.jsx -- this file drives the web.
//
// Selectors: the Pro radios are named "Pro monthly" / "Pro yearly" and the Plus radios
// "Yearly: $29 / year ..." / "Monthly: $3.99 / month". Playwright matches a string name as a
// case-insensitive substring, so the Plus ones are matched with an anchored regex.

async function openBilling(page: Page) {
  // Scoped to .header-bar rather than the holder's name, as in billing.spec.ts.
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Plan & billing' }).click();
  await expect(page.getByRole('button', { name: 'Subscribe to Pro' })).toBeVisible();
}

// Stripe is deliberately absent from the e2e suite (see billing.spec.ts). What matters here is what
// the screen ASKS for, so the request is read and refused; nothing is ever bought.
async function captureCheckoutRequest(page: Page) {
  const bodies: unknown[] = [];
  await page.route('**/api/billing/checkout-session', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"test"}' });
  });
  return bodies;
}

test.describe('the Pro card owns its billing period', () => {
  test('a Free household switches Pro between monthly and yearly on the Pro card, and reaches Unlimited',
    async ({ page, request }) => {
      await registerHousehold(page, request, 'Nate');
      await openBilling(page);
      const bodies = await captureCheckoutRequest(page);

      // Pro opens on monthly (for-trainers.html leads with its Monthly column); Plus stays yearly.
      await expect(page.getByRole('radio', { name: 'Pro monthly' })).toBeChecked();
      await expect(page.getByRole('radio', { name: /^Yearly/ })).toBeChecked();
      await expect(page.getByText('$19 / month', { exact: true })).toBeVisible();

      // Unlimited -- the band App Review could not find -- is right there on monthly.
      await page.getByLabel('How many clients?').selectOption('UNLIMITED');
      await expect(page.getByText('$149 / month', { exact: true })).toBeVisible();

      await page.getByRole('radio', { name: 'Pro yearly' }).check();
      await expect(page.getByText('$1,490 / year', { exact: true })).toBeVisible();
      await expect(page.getByLabel('How many clients?')).toHaveValue('UNLIMITED');

      // The two cards are independent now: moving Plus leaves Pro where the trainer put it.
      await page.getByRole('radio', { name: /^Monthly/ }).check();
      await expect(page.getByRole('radio', { name: 'Pro yearly' })).toBeChecked();
      await expect(page.getByText('$1,490 / year', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Subscribe to Pro' }).click();
      await expect.poll(() => bodies.length).toBe(1);
      expect(bodies[0]).toEqual({ interval: 'YEAR', plan: 'PRO', band: 'UNLIMITED' });
    });

  // The Plus screen has no Plus interval control at all, so before the Pro card carried its own a
  // Plus household could only ever be sold Pro yearly from there.
  test('a Plus household chooses Pro monthly or yearly from its own plan screen', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, email, 'PLUS');
    await page.reload();
    await openBilling(page);
    const bodies = await captureCheckoutRequest(page);

    await expect(page.getByRole('radio', { name: 'Pro monthly' })).toBeChecked();
    await page.getByLabel('How many clients?').selectOption('STUDIO');
    await expect(page.getByText('$39 / month', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Subscribe to Pro' }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ interval: 'MONTH', plan: 'PRO', band: 'STUDIO' });

    await page.getByRole('radio', { name: 'Pro yearly' }).check();
    await expect(page.getByText('$390 / year', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Subscribe to Pro' }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toEqual({ interval: 'YEAR', plan: 'PRO', band: 'STUDIO' });
  });
});

// Choosing a period is a read of prices the bundle already holds, so it must read the same in every
// mode -- even where Subscribe itself is refused (that gate is parity-billing.spec.ts's, and is not
// asserted here because "refuses cleanly" cannot be true online).
forEachConnectivityMode<void>('the Pro card switches its own billing period', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Nate');
  },
  navigate: async (page) => {
    await openBilling(page);
  },
  act: async (page) => {
    await page.getByRole('radio', { name: 'Pro yearly' }).check();
  },
  assert: async (page) => {
    await expect(page.getByText('$190 / year', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Pro yearly' })).toBeChecked();
    await expect(page.getByRole('radio', { name: /^Yearly/ })).toBeChecked();
  },
});
