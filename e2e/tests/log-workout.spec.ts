import { Page, test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { dismissPrCelebration, logSetAt, pickExercise, prCelebration, setStepper, tapLogSet, logSetButton, searchFor, searchTrigger, searchField } from './support/exercises';

// Full golden-path smoke: register a new household, log the first-ever set (always celebrated),
// confirm the celebration fires, then check every tab renders without error.
test.describe('Log workout', () => {
  test('register, log a set, see PR celebration, browse all tabs', { tag: '@critical' }, async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    // A fresh person's picker is empty -- search the catalog to pick an exercise.
    await expect(searchTrigger(page)).toBeVisible();
    await expect(
      page.getByText("Let's find your first exercise")
    ).toBeVisible();
    await pickExercise(page, 'Barbell Bench Press');
    await expect(logSetButton(page)).toBeVisible();

    // Selecting an exercise clears the search box, so returning to the picker starts
    // fresh instead of still showing the old search term.
    await page.getByRole('button', { name: '← All exercises' }).click();
    await expect(searchTrigger(page)).toHaveText('Search all exercises');
    await pickExercise(page, 'Barbell Bench Press');
    await expect(logSetButton(page)).toBeVisible();

    await tapLogSet(page);

    // A first-ever set always gets a card: the quiet "First Barbell Bench Press" once the server
    // has confirmed it, or "New PR!" if the tap beat the summary (first-time-celebration.spec.ts).
    await expect(prCelebration(page)).toBeVisible();
    await page.screenshot({ path: 'test-results/pr-celebration.png' });
    await prCelebration(page).click({ force: true }); // dismiss (scrim click)

    // Logging a set starts the session, so the bottom session bar appears -- carrying the rest
    // timer, which counts UP from 0:00. The readout is deliberately bare digits (no visible "Rest"
    // text, which would substring-collide with Settings' "Rest timer" toggle), so it is selected by
    // its role="img" accessible name.
    await expect(page.getByText(/Session in progress/)).toBeVisible();
    await expect(page.getByRole('img', { name: /^Rest [0-9]/ })).toBeVisible();

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
    await expect(page.getByTestId('people-list').getByText('Owner', { exact: true })).toBeVisible();

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

    await tapLogSet(page);
    await dismissPrCelebration(page);
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
    // this in so a future style tweak can't reintroduce that. The field that takes the focus is
    // the search screen's; the Log page's trigger is drawn the same (`.input`) so it reads as it.
    await expect(searchTrigger(page)).toHaveCSS('font-size', '16px');

    // "barbell squat" isn't a contiguous substring of "Barbell Back Squat" -- the older
    // exact-substring matcher would miss it. Token-based matching should still find it,
    // and clicking the result should select that exercise.
    await searchFor(page, 'barbell squat');
    await expect(searchField(page)).toHaveCSS('font-size', '16px');
    await page.getByRole('button', { name: 'Barbell Back Squat' }).click();
    await expect(logSetButton(page)).toBeVisible();
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
    await expect(logSetButton(page)).toBeVisible();

    // No dialling down any more, and that IS the assertion: Pull-up is a bodyweight exercise
    // (load_type, V108), so once the screen knows it has no history the box reads 0 under "Added
    // weight" and a first-ever Pull-up is correct with zero interaction. This used to require
    // opening the keypad and backspacing the prefilled "45" out first.
    const weightInput = page.getByRole('textbox', { name: 'Added (lb)' });
    await expect(weightInput).toHaveValue('0');

    await tapLogSet(page);
    // The first-ever set gets a card of its own (first-time-celebration.spec.ts); the record this
    // test is about is the NEXT one, which beats it.
    await expect(page.getByText(/^Set 1$/)).toBeVisible();
    await dismissPrCelebration(page);

    // A real bodyweight record -- Epley's 1RM collapses to a meaningless 0 at weight 0, so the
    // celebration shows the rep count instead. Scoped to the overlay: the Best card behind it names
    // the same record ("Most reps · 10 reps").
    await setStepper(page, 'Reps', 10);
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    const celebration = page.getByRole('dialog');
    await expect(celebration.getByText('10 reps')).toBeVisible();
    await expect(celebration.getByText('Bodyweight')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)

    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByText('Pull-up')).toBeVisible();
    await expect(page.getByText('10 reps')).toBeVisible();
    await expect(page.getByText('Bodyweight')).toBeVisible();
  });

  // Holds every exercise-summary response open until released, so the window where the screen has
  // no data for the exercise on it is wide and deterministic instead of a few milliseconds. Both
  // bugs below only show inside that window, which is why they were invisible locally.
  async function holdSummaryRequests(page: Page) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/exercises/*/summary*', async (route) => {
      await held;
      await route.continue();
    });
    return { release: () => release() };
  }

  test('opening another exercise never shows the previous exercise\'s weight', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await pickExercise(page, 'Barbell Bench Press');
    await logSetAt(page, 185, 5);

    await page.getByRole('button', { name: '← All exercises' }).click();
    const summary = await holdSummaryRequests(page);
    await pickExercise(page, 'Pull-up');

    const weightInput = page.getByRole('textbox', { name: 'Added (lb)' });
    const repsInput = page.getByRole('textbox', { name: 'Reps' });
    await expect(weightInput).toBeVisible();

    // Sampled continuously rather than with a retrying matcher: "eventually not 185" would pass
    // even if 185 flashed first, and the flash IS the bug. Pull-up has no history, so the honest
    // answer for this whole window is the em-dash placeholder, or 0 once the History already on the
    // device says it has never been done (Pull-up is a bodyweight exercise) -- never the bench press
    // numbers still sitting in the per-person draft.
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      expect(['', '0']).toContain(await weightInput.inputValue());
      expect(await repsInput.inputValue()).toBe('');
      await page.waitForTimeout(50);
    }

    summary.release();
    await expect(repsInput).toHaveValue('8');
    // Pull-up is a bodyweight exercise: once its (empty) history is known, 0 under "Added".
    await expect(weightInput).toHaveValue('0');
  });

  test('a late summary refetch does not overwrite a weight the person just typed', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await pickExercise(page, 'Barbell Bench Press');
    await expect(logSetButton(page)).toBeVisible();

    // Hold every summary response from here on -- the initial one has already landed, so the next
    // is the invalidation that logging a set triggers. Landing it AFTER the typing below is the
    // exact ordering that took lower red on 2026-08-08; locally it returns in milliseconds and the
    // race is almost never lost.
    const summary = await holdSummaryRequests(page);
    await logSetAt(page, 100, 5);

    await setStepper(page, 'Weight', 315);
    await setStepper(page, 'Reps', 2);

    summary.release();
    // Let the re-seed that response would trigger actually run before reading the field back --
    // a retrying matcher would otherwise pass on the frame before the stomp.
    await page.waitForTimeout(500);

    await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('315');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('315 lb × 2', { exact: true })).toBeVisible();
  });

  test('logs the weight typed immediately before the tap, with no blur first', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await pickExercise(page, 'Barbell Bench Press');

    const weightInput = page.getByRole('textbox', { name: 'Weight (lb)' });
    await weightInput.click();
    await weightInput.fill('225');

    // Deliberately no Enter: tapping the button is what blurs the field, and handleLogSet reads
    // the value from its render closure. setStepper always presses Enter first, so nothing else
    // in the suite covers this ordering.
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('225 lb × 8', { exact: true })).toBeVisible();
  });
});
