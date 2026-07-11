import { test, expect } from '@playwright/test';

// Full golden-path smoke: register a new household, log the first-ever set (always a
// PR), confirm the celebration fires, then check every tab renders without error.
test.describe('Log workout', () => {
  test('register, log a set, see PR celebration, browse all tabs', async ({ page }) => {
    const unique = Date.now();
    const email = `e2e-${unique}@example.com`;

    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill('Nate');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByPlaceholder('Search exercises')).toBeVisible();

    // Pick the first exercise in the library.
    await page.getByRole('button', { name: 'Barbell Bench Press' }).click();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    await page.getByRole('button', { name: 'Log set' }).click();

    // First-ever set is always a PR -- the celebration overlay should appear.
    await expect(page.getByText('New PR!')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/pr-celebration.png' });
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)

    // Rest timer should now be showing.
    await expect(page.getByText('Rest')).toBeVisible();

    // Browse every other tab and confirm each renders its expected empty/seed state.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Today')).toBeVisible();

    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page.getByText('No routines yet.')).toBeVisible();

    // App Settings is reached via the account-holder dropdown in the header, not a tab.
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await expect(page.getByText('Units')).toBeVisible();
    await expect(page.getByText('PRIMARY')).toBeVisible();

    await page.screenshot({ path: 'test-results/app-settings-tab.png' });
  });
});
