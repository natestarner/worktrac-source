import { expect, test } from '@playwright/test';
import { fetchPendingCode } from './support/auth';

// The order of the first-run experience for someone who arrived from marketing's "Go Pro".
//
// They land on the billing screen, and the welcome modal WAITS until the billing decision
// resolves -- a tour interrupting someone mid-purchase is the wrong order. This is the likeliest
// thing in the whole feature to regress silently: nothing breaks if the deferral stops working,
// the modal simply reappears a beat too early and nobody notices.
//
// Registration is driven inline rather than through registerHousehold, because that helper starts
// at /register with no query string and dismisses the welcome modal unconditionally -- both of
// which are the things under test here.
test.describe('Go Pro registration', () => {
  test('lands on billing with the welcome modal deferred, then shows it once the decision resolves',
    async ({ page, request }) => {
      const email = `huddle+e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@starner.co`;

      // The marketing "Go Pro" button links exactly here.
      await page.goto('/register?plan=pro');
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
      await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();

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

  // The control case. An ordinary registration must still get the welcome modal immediately --
  // suppressing it for everyone would be an easy way to make the test above pass.
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
