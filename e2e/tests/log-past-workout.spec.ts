import { test, expect } from '@playwright/test';

async function registerHousehold(page, personName: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto('/register');
  await page.getByPlaceholder('e.g. Alex').fill(personName);
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('At least 8 characters').fill('password123');
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(page).toHaveURL(/\/app\/log/);
}

// Full "Log a past workout" round trip: create a retroactive session, add and remove
// sets into it without triggering the live rest timer, edit its date from the "Editing
// past session" banner, then Done back to History and confirm it landed correctly.
test.describe('Log a past workout', () => {
  test('create a retroactive session, edit its sets and date, and see it in History', async ({ page }) => {
    await registerHousehold(page, 'Jamie');

    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: '+ Log a past workout' }).click();

    const modal = page.getByRole('dialog');
    await modal.locator('input[type="date"]').fill('2026-01-15');
    await modal.locator('input[type="time"]').fill('09:00');
    await modal.getByRole('button', { name: 'Start adding sets' }).click();

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('Editing past session')).toBeVisible();
    await expect(page.locator('input[type="date"]')).toHaveValue('2026-01-15');

    // Log two sets into the retroactive session.
    await page.getByRole('button', { name: 'Barbell Bench Press' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1')).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 2')).toBeVisible();

    // Sets added while editing a past session must never start the live rest timer.
    await expect(page.getByText('Rest')).toHaveCount(0);

    // Remove the newest set (rows render newest-first, so the first "Delete" link in DOM
    // order belongs to Set 2's row). Two "Delete" buttons exist before the confirm dialog
    // opens (one per row), so `.first()` disambiguates; the dialog's own "Delete" button
    // is scoped separately below once it's the only one on screen.
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Set 2')).toHaveCount(0);
    await expect(page.getByText('Set 1')).toBeVisible();

    // Edit the session's date from the "Editing past session" banner (a second,
    // independent edit path from the creation modal above).
    await page.locator('input[type="date"]').fill('2026-01-16');
    await expect(page.locator('input[type="date"]')).toHaveValue('2026-01-16');

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/app\/history/);

    await expect(page.getByText('Jan 16')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
  });
});
