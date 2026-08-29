import { test, expect } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { pickExercise } from './support/exercises';

// Full "Log a past workout" round trip: create a retroactive session, add and remove
// sets into it without triggering the live rest timer, edit its date from the "Editing
// past session" banner, then Done back to History and confirm it landed correctly.
test.describe('Log a past workout', () => {
  test('create a retroactive session, edit its sets and date, and see it in History', async ({ page, request }) => {
    // Pro, because the retroactive date below is months back -- outside the Free tier's 90-day
    // window, which would correctly hide the session this spec then asserts is in History. The
    // round trip is what is being tested, not the window.
    //
    // ⚠️ That combination is a real product gap, not just a test detail: a Free household can
    // complete this whole flow and land back on History with nothing there. Flagged for a
    // follow-up decision (warn, clamp the date picker, or accept) rather than silently changed
    // here.
    const email = await registerHousehold(page, request, 'Jamie');
    await setBillingPlan(request, email, 'PRO');
    await page.reload();

    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: '+ Log a past workout' }).click();

    const modal = page.getByRole('dialog');
    await modal.locator('input[type="date"]').fill('2026-01-15');
    await modal.locator('input[type="time"]').fill('09:00');
    await modal.getByRole('button', { name: 'Start adding sets' }).click();

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('Editing past session')).toBeVisible();
    await expect(page.locator('input[type="date"]')).toHaveValue('2026-01-15');

    // Log two sets into the retroactive session (picker is empty for a new person -- search).
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1')).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 2')).toBeVisible();

    // Sets added while editing a past session must never start the live rest timer -- and the
    // session bar stays away entirely, because editing a past session is an editor, not a live
    // session. (Its own date/time card above stays in flow; that one IS a form.)
    await expect(page.getByRole('img', { name: /^Rest [0-9]/ })).toHaveCount(0);
    await expect(page.getByText(/Session in progress/)).toHaveCount(0);

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
