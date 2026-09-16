import { expect, test } from '@playwright/test';
import { fetchPendingCode } from './support/auth';

// The order of the first-run experience for someone who arrived from marketing's "Go Plus".
//
// They land on the billing screen, and the welcome modal WAITS until the billing decision
// resolves -- a tour interrupting someone mid-purchase is the wrong order. This is the likeliest
// thing in the whole feature to regress silently: nothing breaks if the deferral stops working,
// the modal simply reappears a beat too early and nobody notices.
//
// Registration is driven inline rather than through registerHousehold, because that helper starts
// at /register with no query string and dismisses the welcome modal unconditionally -- both of
// which are the things under test here.
//
// The trainer page's ?plan=pro CTAs take the same path and get their own test below. They shipped
// while RegisterPage understood only 'plus', so every trainer was silently treated as having named
// no plan and dropped on Log -- with marketing e2e asserting the links carried plan=pro the whole
// time, because nothing on this side was checking that anyone READ it.
test.describe('registration arriving from a marketing plan CTA', () => {
  test('lands on billing with the welcome modal deferred, then shows it once the decision resolves',
    async ({ page, request }) => {
      const email = `huddle+e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@starner.co`;

      // The marketing "Go Plus" button links exactly here.
      await page.goto('/register?plan=plus');
      await page.getByPlaceholder('e.g. Alex').fill('Nate');
      await page.getByPlaceholder('you@example.com').fill(email);
      await page.getByPlaceholder('At least 8 characters').fill('password123');
      await page.getByRole('button', { name: 'Create household' }).click();
      await expect(page).toHaveURL(/\/confirm-email/);

      const configResponse = await request.get('/config.json');
      const { apiUrl } = await configResponse.json();
      const code = await fetchPendingCode(request, apiUrl, email);
      await page.getByPlaceholder('123456').fill(code);
      await page.getByRole('button', { name: 'Confirm' }).click();

      // Landed on billing rather than Log, because they came here intending to pay.
      await expect(page).toHaveURL(/\/app\/billing/);
      await expect(page.getByRole('button', { name: 'Upgrade to Plus' })).toBeVisible();

      // ⚠️ toHaveCount(0), NOT a passing isVisible() check. isVisible() has no auto-waiting, so it
      // returns false while the modal is merely still mounting -- it would pass against a
      // completely broken deferral and guard nothing. The Upgrade button being visible above is
      // what proves the screen has actually settled by this point.
      await expect(page.getByRole('dialog', { name: 'Welcome to Huddle' })).toHaveCount(0);

      // Resolving the decision the other way -- choosing to stay on Free -- releases it.
      await page.getByRole('button', { name: /Start with Free/ }).click();
      await expect(page).toHaveURL(/\/app\/log/);

      await expect(page.getByRole('dialog', { name: 'Welcome to Huddle' })).toBeVisible();
    });

  // The trainer half. marketing/for-trainers.html's three CTAs all link to /register?plan=pro, and
  // this is the end-to-end proof that naming Pro on the way in actually reaches billing -- the
  // whole journey that was broken. Asserting the Pro card specifically, not just the URL: billing
  // puts Plus first and keeps Pro deliberately quiet below it, so "landed on /app/billing" alone
  // would not tell a trainer their card is there.
  test('a trainer arriving with ?plan=pro lands on billing, with the Pro card there', async ({ page, request }) => {
    const email = `huddle+e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@starner.co`;

    await page.goto('/register?plan=pro');
    await page.getByPlaceholder('e.g. Alex').fill('Sam');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/confirm-email/);

    const configResponse = await request.get('/config.json');
    const { apiUrl } = await configResponse.json();
    const code = await fetchPendingCode(request, apiUrl, email);
    await page.getByPlaceholder('123456').fill(code);
    await page.getByRole('button', { name: 'Confirm' }).click();

    // Billing rather than Log -- this is precisely what ?plan=pro used to fail to do.
    await expect(page).toHaveURL(/\/app\/billing/);

    // ⚠️ toBeInViewport, not toBeVisible. This screen leads with Plus and puts the Pro card below
    // it, so on a phone-height viewport "visible" is true for a card sitting well below the fold --
    // it would pass without the scroll and guard nothing. Only the real browser can answer this;
    // jsdom computes no layout, so the unit test can assert the scroll CALL but never its effect.
    await expect(page.getByRole('button', { name: 'Subscribe to Pro' })).toBeInViewport();

    // The jump is a one-shot: it must not be left in the URL to replay on a reload or a shared link.
    await expect(page).not.toHaveURL(/intent=/);

    // Same deferral as the Plus path: both named a plan, so neither gets the tour mid-decision.
    await expect(page.getByRole('dialog', { name: 'Welcome to Huddle' })).toHaveCount(0);
  });

  // The control case. An ordinary registration must still get the welcome modal immediately --
  // suppressing it for everyone would be an easy way to make the tests above pass.
  test('an ordinary registration still gets the welcome modal straight away', async ({ page, request }) => {
    const email = `huddle+e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@starner.co`;

    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill('Nate');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/confirm-email/);

    const configResponse = await request.get('/config.json');
    const { apiUrl } = await configResponse.json();
    const code = await fetchPendingCode(request, apiUrl, email);
    await page.getByPlaceholder('123456').fill(code);
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByRole('dialog', { name: 'Welcome to Huddle' })).toBeVisible();
  });
});
