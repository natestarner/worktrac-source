import { test, expect } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { dismissPrCelebration, pickExercise } from './support/exercises';

// Full "Log a past workout" round trip: create a retroactive session, add and remove
// sets into it without triggering the live rest timer, edit its date from the "Adding/editing
// past session" header, then Done back to History and confirm it landed correctly.
test.describe('Log a past workout', () => {
  test('create a retroactive session, edit its sets and date, and see it in History', async ({ page, request }) => {
    // Plus, because the retroactive date below is months back -- outside the Free tier's 90-day
    // window, which would correctly hide the session this spec then asserts is in History. The
    // round trip is what is being tested, not the window.
    //
    // The Free side of that combination used to be an unhandled product gap (complete the flow,
    // land on History, be told "No workouts logged yet"). It is now handled and covered by
    // free-window-notice.spec.ts: the modal warns before the date is accepted, and History
    // explains itself afterwards. So this line is a deliberate choice of subject, not a
    // workaround -- keep it, or this spec starts testing the window instead of the round trip.
    const email = await registerHousehold(page, request, 'Jamie');
    await setBillingPlan(request, email, 'PLUS');
    await page.reload();

    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Log a past workout' }).click();

    const modal = page.getByRole('dialog');
    await modal.locator('input[type="date"]').fill('2026-01-15');
    await modal.locator('input[type="time"]').fill('09:00');
    await modal.getByRole('button', { name: 'Start adding sets' }).click();

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('Adding/editing past session')).toBeVisible();
    await expect(page.locator('input[type="date"]')).toHaveValue('2026-01-15');

    // Log two sets into the retroactive session (picker is empty for a new person -- search).
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 2')).toBeVisible();

    // Sets added while editing a past session must never start the live rest timer -- and the
    // session bar stays away entirely, because editing a past session is an editor, not a live
    // session. (Its own date/time card above stays in flow; that one IS a form.)
    await expect(page.getByRole('img', { name: /^Rest [0-9]/ })).toHaveCount(0);
    await expect(page.getByText(/Session in progress/)).toHaveCount(0);

    // The whole screen -- not just the header -- sits inside the past-session frame, so the mode
    // stays visible below the fold. A drawn outline, not merely a wrapper: the header alone
    // scrolls away on the exercise screen.
    const frame = page.getByRole('region', { name: 'Adding/editing past session' });
    await expect(frame.getByRole('button', { name: 'Log set' })).toBeVisible();
    await expect(frame).toHaveCSS('border-top-style', 'solid');
    await expect(frame).not.toHaveCSS('border-left-width', '0px');

    // Remove the newest set (rows render newest-first, so the first "Delete" link in DOM
    // order belongs to Set 2's row). Two "Delete" buttons exist before the confirm dialog
    // opens (one per row), so `.first()` disambiguates; the dialog's own "Delete" button
    // is scoped separately below once it's the only one on screen.
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Set 2')).toHaveCount(0);
    await expect(page.getByText('Set 1')).toBeVisible();

    // Edit the session's date from the "Adding/editing past session" header (a second,
    // independent edit path from the creation modal above).
    await page.locator('input[type="date"]').fill('2026-01-16');
    await expect(page.locator('input[type="date"]')).toHaveValue('2026-01-16');

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/app\/history/);

    await expect(page.getByText('Jan 16')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    // …and once Done, the Log tab is unframed: that outline must mean "past session" and nothing
    // else. Wait for the tab's own content first, or the zero count passes before it renders.
    await page.getByRole('link', { name: 'Log', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Log set' }).or(page.getByPlaceholder('Search all exercises')),
    ).toBeVisible();
    await expect(page.locator('.past-session-frame')).toHaveCount(0);
  });
});
