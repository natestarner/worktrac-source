import { expect, test } from '@playwright/test';

// Where Stripe's HOSTED checkout lands -- the App Store app's US-storefront purchase opens it in the
// phone's browser, which is usually signed out of Huddle. So the page must render for a signed-out
// browser, never bounce to /login, and need no request to say what happened. The app itself
// confirms the payment when it returns to the foreground (useCheckoutResume, unit-tested).
test.describe('checkout complete (hosted checkout landing)', () => {
  test('a paid return thanks them and points back to the app, signed out', { tag: '@critical' }, async ({ page }) => {
    await page.goto('/checkout-complete?session_id=cs_test_e2e_123');

    await expect(page.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
    await expect(page.getByText(/Go back to the Huddle app/)).toBeVisible();
    await expect(page).toHaveURL(/\/checkout-complete/);

    // The escape hatch for someone who IS signed in in this browser: the same reconcile a web
    // checkout ends with.
    await expect(page.getByRole('link', { name: 'Open Huddle in this browser instead' })).toHaveAttribute(
      'href',
      '/app/billing?checkout=cs_test_e2e_123',
    );
  });

  test('a cancelled checkout says nothing was charged and offers no link', { tag: '@critical' }, async ({ page }) => {
    await page.goto('/checkout-complete?cancelled=1');

    await expect(page.getByRole('heading', { name: 'Checkout cancelled' })).toBeVisible();
    await expect(page.getByText(/Nothing was charged/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Huddle in this browser instead' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/checkout-complete/);
  });
});
