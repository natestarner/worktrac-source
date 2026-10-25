import { expect, test } from '@playwright/test';

// Where Stripe's Customer Portal sends "Return to Huddle" for the App Store app, inside its in-app
// browser sheet. That sheet has its own storage, so it is always signed out of Huddle: the page
// must render signed out, never bounce to /login, and need no request to say what to do next.
test.describe('billing done (Customer Portal return in the app)', () => {
  test('tells a signed-out browser sheet how to get back to the app', async ({ page }) => {
    await page.goto('/billing-done');

    await expect(page.getByRole('heading', { name: 'All done' })).toBeVisible();
    await expect(page.getByText(/Close this window with the button in the top-left corner/)).toBeVisible();
    await expect(page).toHaveURL(/\/billing-done$/);

    // Nothing to follow: any link into the web app would open it signed out, inside the sheet.
    await expect(page.getByRole('link')).toHaveCount(0);
  });
});
