import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// The header's account-holder dropdown trigger shows the primary person's name too, so
// an unscoped getByRole('button', { name: /Name/ }) can match both it and that person's
// pill here -- scope to .person-pill-bar (the pill row's own container) to disambiguate.
function personPill(page, name: string) {
  return page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) });
}

test.describe('Multi-person switching', () => {
  test('switching people and back resumes exactly where each left off', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');

    // Alex picks an exercise -- this is the "in-progress" state that should be
    // preserved when switching away and back.
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    // Add Sam and switch to them.
    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Newly added person becomes active, and starts with no exercise selected.
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();

    // Switch back to Alex -- should return to Barbell Bench Press, not the picker.
    await personPill(page, 'Alex').click();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    // Switch to Sam again -- still no exercise selected for them.
    await personPill(page, 'Sam').click();
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();
  });

  test('switching people preserves which tab each person was viewing', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Sam navigates to Routines while active.
    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page).toHaveURL(/\/app\/routines/);

    // Switch to Alex -- Alex was last on Log (never navigated away), not Routines.
    await personPill(page, 'Alex').click();
    await expect(page).toHaveURL(/\/app\/log/);

    // Alex browses to History.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/app\/history/);

    // Switching back to Sam must resume Sam's own last tab (Routines), not whichever
    // tab was showing most recently overall (Alex's History).
    await personPill(page, 'Sam').click();
    await expect(page).toHaveURL(/\/app\/routines/);

    // And switching back to Alex resumes Alex's own last tab (History).
    await personPill(page, 'Alex').click();
    await expect(page).toHaveURL(/\/app\/history/);
  });

  test('logging out and back in resets every person\'s tab to Log, not wherever they left off', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Alex');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Sam (auto-selected after being added) browses to Routines.
    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page).toHaveURL(/\/app\/routines/);

    // Switch to Alex and browse to Trends.
    await personPill(page, 'Alex').click();
    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page).toHaveURL(/\/app\/trends/);

    // A mid-session reload must still resume Alex's last tab (Trends) -- unaffected by this fix,
    // which only resets tabs on a real login, never a reload.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/trends/);

    // Log out and back in as the same household -- this IS a fresh login, not a reload.
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill('password123');
    await page.getByRole('button', { name: 'Log in' }).click();

    // Alex (still the active person from before logout) lands on Log, not Trends.
    await expect(page).toHaveURL(/\/app\/log/);

    // Sam, who was on Routines, also now starts on Log.
    await personPill(page, 'Sam').click();
    await expect(page).toHaveURL(/\/app\/log/);
  });

  test('switching people away from an in-progress past-session edit and back resumes it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Alex starts logging a past workout.
    await personPill(page, 'Alex').click();
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: '+ Log a past workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start adding sets' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('Editing past session')).toBeVisible();

    // Switch away to Sam, then back to Alex -- Alex must still be editing that same
    // past session, not dropped back to normal live logging.
    await personPill(page, 'Sam').click();
    await personPill(page, 'Alex').click();
    await expect(page.getByText('Editing past session')).toBeVisible();
  });

  test('each person has their own independent rest timer', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Alex logs a set -- starts Alex's own rest timer.
    await personPill(page, 'Alex').click();
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true });
    await expect(page.getByText('Rest')).toBeVisible();

    // Sam has never logged anything -- switching to Sam must NOT show Alex's timer.
    await personPill(page, 'Sam').click();
    await expect(page.getByText('Rest')).toHaveCount(0);

    // Switching back to Alex, their timer is still running (not reset or destroyed by
    // having switched away).
    await personPill(page, 'Alex').click();
    await expect(page.getByText('Rest')).toBeVisible();
  });

  test('ending the workout stops that person\'s rest timer', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');
    await pickExercise(page, 'Barbell Bench Press');

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)
    await expect(page.getByText('Rest')).toBeVisible();

    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();
    await expect(page.getByText('Rest')).toHaveCount(0);
  });

  test('switching people preserves a half-typed exercise search', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    await personPill(page, 'Alex').click();
    await page.getByPlaceholder('Search all exercises').fill('bench');

    // Sam's search box starts empty, unaffected by Alex's search.
    await personPill(page, 'Sam').click();
    await expect(page.getByPlaceholder('Search all exercises')).toHaveValue('');

    // Switching back to Alex restores what they'd typed.
    await personPill(page, 'Alex').click();
    await expect(page.getByPlaceholder('Search all exercises')).toHaveValue('bench');
  });
});
