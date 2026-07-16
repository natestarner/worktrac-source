import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// Full golden-path smoke: register a new household, log the first-ever set (always a
// PR), confirm the celebration fires, then check every tab renders without error.
test.describe('Log workout', () => {
  test('register, log a set, see PR celebration, browse all tabs', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    // A fresh person's picker is empty -- search the catalog to pick an exercise.
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    await page.getByRole('button', { name: 'Log set' }).click();

    // First-ever set is always a PR -- the celebration overlay should appear.
    await expect(page.getByText('New PR!')).toBeVisible();
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

    // App Settings and Profile are both reached via the account-holder dropdown in the
    // header, not a tab.
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await expect(page.getByText('Units')).toBeVisible();

    await page.screenshot({ path: 'test-results/app-settings-tab.png' });

    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page.getByText('PRIMARY')).toBeVisible();

    await page.screenshot({ path: 'test-results/profile-tab.png' });
  });
});
