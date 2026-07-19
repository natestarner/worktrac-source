import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// The rest-timer bar is enabled by default and shown after every live set (see
// log-workout.spec.ts's PR-celebration test). This covers the new Settings toggle: turning it
// off hides the bar on the next set, and turning it back on restores it -- purely a display
// preference, so it must never block logging sets either way.
test.describe('Rest timer setting', () => {
  test('turning the rest timer off hides it, turning it back on restores it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await pickExercise(page, 'Barbell Bench Press');

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)
    await expect(page.getByText('Rest')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await expect(page.getByText('Rest Timer')).toBeVisible();
    await page.getByRole('button', { name: 'Off', exact: true }).click();
    await page.getByRole('button', { name: /Back/ }).click();

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Rest')).not.toBeVisible();

    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await page.getByRole('button', { name: 'On', exact: true }).click();
    await page.getByRole('button', { name: /Back/ }).click();

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Rest')).toBeVisible();
  });
});
