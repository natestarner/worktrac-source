import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

test.describe('CSV export', () => {
  test('exporting data from History triggers a file download', async ({ page, request }) => {
    await registerHousehold(page, request, 'Casey');

    // Log a set first so the export isn't trivially empty.
    await page.getByRole('button', { name: 'Barbell Bench Press' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true });

    await page.getByRole('link', { name: 'History' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^Casey-workout-data-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
