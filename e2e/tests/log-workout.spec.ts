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
    await expect(
      page.getByText('No favorite exercises yet. Search the exercise library above to find one, or add your own below.')
    ).toBeVisible();
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    // Selecting an exercise clears the search box, so returning to the picker starts
    // fresh instead of still showing the old search term.
    await page.getByRole('button', { name: '← All exercises' }).click();
    await expect(page.getByPlaceholder('Search all exercises')).toHaveValue('');
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

  // Removing a synced exercise from the session summary had NO e2e coverage at all, which mattered
  // once its already-synced deletes moved from a direct awaited `deleteSet` onto the durable
  // DELETE_SET write: the dispatch no longer blocks, so `onChanged()`'s refetch now races the
  // server delete. If that race is lost the row comes back -- so this asserts it stays gone,
  // including across a reload (i.e. the delete really reached the server, not just the cache).
  test('removing a synced exercise from the session summary keeps it gone', async ({ page, request }) => {
    await registerHousehold(page, request, 'Quinn');
    await pickExercise(page, 'Barbell Bench Press');

    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: '← All exercises' }).click();
    const sessionList = page.locator('.session-exercises');
    await expect(sessionList.getByText('Barbell Bench Press')).toBeVisible();

    await sessionList.getByRole('button', { name: 'Remove' }).click();
    // ConfirmDialog's confirm button is always labelled "Delete", whatever the action.
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(sessionList.getByText('Barbell Bench Press')).toBeHidden();
    // The refetch that races the delete would resurrect the row here if the write hadn't landed.
    await page.waitForTimeout(1500);
    await expect(sessionList.getByText('Barbell Bench Press')).toBeHidden();

    await page.reload();
    await expect(page.locator('.session-exercises').getByText('Barbell Bench Press')).toBeHidden();
  });

  test('search is forgiving of word order', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    // iOS Safari auto-zooms the page on focus for any input under 16px font-size -- lock
    // this in so a future style tweak can't reintroduce that.
    await expect(page.getByPlaceholder('Search all exercises')).toHaveCSS('font-size', '16px');

    // "barbell squat" isn't a contiguous substring of "Barbell Back Squat" -- the older
    // exact-substring matcher would miss it. Token-based matching should still find it,
    // and clicking the result should select that exercise.
    await page.getByPlaceholder('Search all exercises').fill('barbell squat');
    await page.getByRole('button', { name: 'Barbell Back Squat' }).click();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
  });

  test('nudges a routine-less person to create one, links to Routines, and stays dismissed', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await expect(page.getByText('create a routine')).toBeVisible();
    await page.getByText('create a routine').click();
    await expect(page).toHaveURL(/\/app\/routines/);

    await page.getByRole('link', { name: 'Log' }).click();
    await expect(page.getByText('create a routine')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('create a routine')).not.toBeVisible();

    await page.reload();
    await expect(page.getByText('create a routine')).not.toBeVisible();
  });

  test('shows reps instead of a weight/1RM calc for a bodyweight PR', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await pickExercise(page, 'Pull-up');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    // No dialling down any more, and that IS the assertion: an exercise with no history has no
    // prefilled weight at all (an em dash placeholder, not a number), and a blank weight logs as
    // 0. A first-ever Pull-up is therefore correct with zero interaction. This used to require
    // opening the keypad and backspacing the prefilled "45" out first.
    const weightInput = page.getByRole('textbox', { name: 'Weight (lb)' });
    await expect(weightInput).toHaveValue('');
    await expect(weightInput).toHaveAttribute('placeholder', '—');

    await page.getByRole('button', { name: 'Log set' }).click();

    // First-ever set is always a PR -- Epley's 1RM collapses to a meaningless 0 at
    // weight 0, so the celebration should show the rep count instead.
    await expect(page.getByText('New PR!')).toBeVisible();
    await expect(page.getByText('8 reps')).toBeVisible();
    await expect(page.getByText('Bodyweight')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)

    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByText('Pull-up')).toBeVisible();
    await expect(page.getByText('8 reps')).toBeVisible();
    await expect(page.getByText('Bodyweight')).toBeVisible();
  });
});
