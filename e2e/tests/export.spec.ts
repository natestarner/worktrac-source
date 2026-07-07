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

test.describe('CSV export', () => {
  test('exporting data from History triggers a file download', async ({ page }) => {
    await registerHousehold(page, 'Casey');

    // Log a set first so the export isn't trivially empty.
    await page.getByRole('button', { name: 'Barbell Bench Press' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible({ timeout: 5000 });
    await page.getByText('New PR!').click({ force: true });

    await page.getByRole('link', { name: 'History' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^Casey-workout-data-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
