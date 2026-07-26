import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { goHardOffline, goOnline, outboxCountText, waitForOutboxDrain } from './support/offline';

function personPill(page, name: string) {
  return page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) });
}

test.describe('Connectivity transitions', () => {
  test('repeated online/offline flapping while logging never duplicates a set', async ({ page, request }) => {
    await registerHousehold(page, request, 'Reese');
    await pickExercise(page, 'Barbell Bench Press');

    await goHardOffline(page);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    // Flap several times before the write ever gets a chance to fully settle.
    await goOnline(page);
    await goHardOffline(page);
    await goOnline(page);
    await goHardOffline(page);
    await goOnline(page);

    await waitForOutboxDrain(page);
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await expect(page.getByText('Set 1')).toHaveCount(1);
  });

  test('switching people offline keeps each person\'s queued writes independent, with a combined device-wide count', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sage');
    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Wren');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Back to Sage, log a set offline.
    await personPill(page, 'Sage').click();
    await pickExercise(page, 'Barbell Bench Press');
    await goHardOffline(page);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Switch to Wren (still offline) and log a set for them too -- the banner's outbox count is
    // device-wide (not per-person, see useOutboxCount.js), but each person's own screen only ever
    // shows their own sets -- no leak.
    await personPill(page, 'Wren').click();
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await expect(outboxCountText(page, 2)).toBeVisible();

    await goOnline(page);
    await waitForOutboxDrain(page);

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('No workouts logged yet for Wren.')).toBeHidden();

    await personPill(page, 'Sage').click();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
  });

  test('logging out with unsynced changes warns before discarding them', async ({ page, request }) => {
    await registerHousehold(page, request, 'Tatum');
    await pickExercise(page, 'Barbell Bench Press');
    await goHardOffline(page);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();

    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();

    await expect(page.getByRole('alertdialog', { name: 'Unsynced changes' })).toBeVisible();
    await expect(page.getByText(/1 change hasn.t synced yet/)).toBeVisible();

    // Cancel keeps the session (and the queued write) intact -- the menu itself stays open
    // (only the confirm sub-panel collapses back to a normal Logout item), so close it explicitly.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Reconnect, let it drain, then logout goes through with no warning.
    await goOnline(page);
    await waitForOutboxDrain(page);
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
