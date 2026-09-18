import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

test.describe('CSV export', () => {
  test('exporting data from History triggers a file download', async ({ page, request }) => {
    await registerHousehold(page, request, 'Casey');

    // Log a set first so the export isn't trivially empty.
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true });

    await page.getByRole('link', { name: 'History' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^Casey-workout-data-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  // Offering a control that would only ever produce an empty file reads as unfinished, not as
  // "nothing here yet". Both export buttons stay disabled until this person -- or, for the
  // Settings one, anyone in the household -- has actually logged something, then enable
  // immediately once they do.
  test('both export buttons stay disabled until something has been logged, then enable', async ({ page, request }) => {
    await registerHousehold(page, request, 'Drew');

    await page.getByRole('link', { name: 'History' }).click();
    const historyExport = page.getByRole('button', { name: 'Export data' });
    await expect(historyExport).toBeDisabled();
    await expect(historyExport).toHaveAttribute('title', /nothing to export/i);

    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    const settingsExport = page.getByRole('button', { name: 'Export all data' });
    await expect(settingsExport).toBeDisabled();

    await page.getByRole('link', { name: 'Log' }).click();
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true });

    await page.getByRole('link', { name: 'History' }).click();
    await expect(historyExport).toBeEnabled();

    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await expect(settingsExport).toBeEnabled();
  });
});
