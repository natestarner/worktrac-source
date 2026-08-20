import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// The rest timer is enabled by default and starts after every live set (see log-workout.spec.ts's
// PR-celebration test). This covers the Settings screen's rest-timer section: it is household-wide
// -- every person gets their own toggle, all shown together on one screen (not scoped to whichever
// person is currently active) -- and toggling one person's preference is persisted server-side (not
// per-device) and never affects another person's.
//
// The preference suppresses the READOUT (the session bar's timer slot and the person pill's ring),
// never the session bar itself: someone who has switched their rest timer off still has a workout
// to end.
function restReadout(page) {
  return page.getByRole('img', { name: /^Rest [0-9]/ });
}

test.describe('Rest timer setting', () => {
  test('turning the rest timer off hides it, turning it back on restores it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await pickExercise(page, 'Barbell Bench Press');

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)
    await expect(restReadout(page)).toBeVisible();

    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await expect(page.getByText('Rest Timer')).toBeVisible();
    await page.getByRole('button', { name: 'Rest timer Off for Nate' }).click();
    await page.getByRole('button', { name: /Back/ }).click();

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(restReadout(page)).toHaveCount(0);
    // The bar itself stays -- only the timer slot inside it is suppressed.
    await expect(page.getByText(/Session in progress/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'End workout' })).toBeVisible();

    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await page.getByRole('button', { name: 'Rest timer On for Nate' }).click();
    await page.getByRole('button', { name: /Back/ }).click();

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(restReadout(page)).toBeVisible();
  });

  test('every person on the account gets their own toggle, shown together on one screen', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Settings shows a toggle for BOTH people at once -- no need to switch the active
    // person to configure someone else's preference.
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await expect(page.getByRole('button', { name: 'Rest timer On for Nate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rest timer On for Sam' })).toBeVisible();

    // Turning Sam's off must not affect Nate's.
    await page.getByRole('button', { name: 'Rest timer Off for Sam' }).click();
    await expect(page.getByRole('button', { name: 'Rest timer On for Nate' })).toBeVisible();
    await page.getByRole('button', { name: /Back/ }).click();

    // Confirmed server-side, not per-device: reloading the app keeps Sam's preference off
    // and Nate's on.
    await page.reload();
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();
    await expect(page.getByRole('button', { name: 'Rest timer On for Nate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rest timer Off for Sam' })).toBeVisible();
  });
});
