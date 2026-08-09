import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise, logSetAt } from './support/exercises';

// Tags an exercise via its Customize modal, one tag at a time. Submits via the "New tag"
// input's own Enter handler rather than its "Add" button -- ConfigureExerciseModal has a SECOND
// "Add" button (setup fields) once any exist, so Enter is the unambiguous way in (see
// admin.spec.ts's identical note for the setup-fields "Add" button).
async function tagExercise(page, tagName: string) {
  await page.getByRole('button', { name: 'Customize this exercise' }).click();
  await page.getByPlaceholder('New tag').fill(tagName);
  await page.getByPlaceholder('New tag').press('Enter');
  await expect(page.getByRole('dialog').getByRole('button', { name: tagName, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
}

async function logSetAndDismissCelebration(page) {
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(page.getByText('New PR!')).toBeVisible();
  await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)
}

// Covers requirements 2-5 from the History/PRs search-and-tag redesign: tags show and filter both
// tabs, History marks which sets were PRs at the time, tapping an exercise name in History filters
// to it, and every filter clears on navigate-away (and survives a reload precisely because it was
// never there to begin with).
test.describe('History and PRs: tags, PR markers, and click-to-filter', () => {
  test('tag chips filter both tabs, History marks PRs, and click-to-filter narrows and clears', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Barbell Bench Press');
    await tagExercise(page, 'Push');
    await logSetAndDismissCelebration(page);

    await page.getByRole('button', { name: '← All exercises' }).click();
    await pickExercise(page, 'Barbell Back Squat');
    await tagExercise(page, 'Legs');
    await logSetAndDismissCelebration(page);

    // --- History: tag chips, PR markers, search, tag filter, click-to-filter ---
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Today')).toBeVisible();

    // Each set logged was the exercise's first-ever, so both are marked as a PR.
    await expect(page.getByTitle('Personal record')).toHaveCount(2);

    // Tag filter chips are built from what's actually on screen, not the full account vocabulary.
    const pushFilterChip = page.getByRole('button', { name: 'Push', exact: true });
    const legsFilterChip = page.getByRole('button', { name: 'Legs', exact: true });
    await expect(pushFilterChip).toBeVisible();
    await expect(legsFilterChip).toBeVisible();

    // Search narrows to the matching exercise only.
    await page.getByLabel('Search exercises').fill('squat');
    await expect(page.getByText('Barbell Back Squat')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    // Tag filter narrows the same way.
    await legsFilterChip.click();
    await expect(page.getByText('Barbell Back Squat')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear all' }).click();

    // Clicking an exercise name filters History to just that exercise (requirement 4).
    await page.getByRole('button', { name: 'Show only Barbell Bench Press in history' }).click();
    await expect(page.getByRole('button', { name: 'Stop filtering to Barbell Bench Press' })).toBeVisible();
    // "Barbell Bench Press" now also matches the active-filter pill itself, not just the row --
    // assert via the unambiguous row link instead of plain text.
    await expect(page.getByRole('button', { name: 'Show only Barbell Bench Press in history' })).toBeVisible();
    await expect(page.getByText('Barbell Back Squat')).toHaveCount(0);

    // --- Requirement 5: navigating away and back clears the filter ---
    // The currently-selected exercise (Squat) is still selected in AppStateContext, so the "Log"
    // nav link lands directly on its detail screen (with its own "View full exercise history" link, which
    // also contains "Barbell Back Squat" text) -- wait for each route to fully settle before
    // asserting so that screen's DOM can't still be present when History's is queried.
    await page.getByRole('link', { name: 'Log' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/app\/history/);
    await expect(page.getByRole('button', { name: 'Stop filtering to Barbell Bench Press' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show only Barbell Back Squat in history' })).toBeVisible();

    // --- PRs tab: tag chip + tapping a row jumps to History pre-filtered ---
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByText('Barbell Back Squat')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Legs', exact: true })).toBeVisible();

    await page.getByText('Barbell Back Squat').click();
    await expect(page).toHaveURL(/\/app\/history/);
    await expect(page.getByRole('button', { name: 'Stop filtering to Barbell Back Squat' })).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toHaveCount(0);
  });

  test('the exercise screen\'s "View full exercise history" link deep-links into a filtered History with a way back, and the seed does not survive a reload', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Barbell Bench Press');
    await logSetAndDismissCelebration(page);

    await page.getByRole('button', { name: /View full exercise history for Barbell Bench Press/ }).click();

    await expect(page).toHaveURL(/\/app\/history/);
    await expect(page.getByText(/Back to Barbell Bench Press/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop filtering to Barbell Bench Press' })).toBeVisible();

    // The "Back to" link returns to the exact exercise screen it came from.
    await page.getByText(/Back to Barbell Bench Press/).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    // Re-follow the deep link, then reload -- the seed is scrubbed from router state the moment
    // History mounts, so even a hard reload on this exact URL must NOT resurrect the filter.
    await page.getByRole('button', { name: /View full exercise history for Barbell Bench Press/ }).click();
    await expect(page.getByRole('button', { name: 'Stop filtering to Barbell Bench Press' })).toBeVisible();

    await page.reload();
    await expect(page.getByText('Today')).toBeVisible(); // History has rendered post-reload
    await expect(page.getByText(/Back to Barbell Bench Press/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop filtering to Barbell Bench Press' })).toHaveCount(0);
    await expect(page.getByText('Barbell Bench Press')).toBeVisible(); // still there, just unfiltered
  });

  // Regression test for a real bug (found 2026-08-05): PersonExerciseService#listForPerson's
  // picker-membership check counted favorite/note/logged but not tags or custom fields, so
  // tagging a never-logged/favorited exercise applied the tag successfully server-side but the
  // exercise never entered the person-scoped list that carries tags -- the chip could never
  // render anywhere, not even after navigating away and back, because there was no refetch that
  // would ever include it. Fixed by adding tags/customFields to that union (see PersonExercise's
  // class comment). This spec deliberately tags BEFORE ever logging or favoriting, unlike the
  // spec above (which happens to log first) -- that ordering is exactly what exposed the bug.
  test('tagging a never-logged, never-favorited exercise shows the tag immediately, with no navigation needed', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
    await tagExercise(page, 'Push');

    await expect(page.getByText('Push')).toBeVisible();
  });
});

// The PRs board absorbed "what got better lately" when the Trends Recent PRs card was removed as
// redundant, so ordering is now a first-class control here rather than a fixed A-Z list.
test.describe('PRs board sorting', () => {
  const boardOrder = async (page) =>
    page.locator('button').filter({ hasText: /^Barbell / }).allTextContents();

  // Each PR has to land in its OWN session. A PR row is dated by its session's startedAt, so three
  // exercises logged in one workout share a timestamp exactly and fall through to the name
  // tiebreak -- which silently turns "most recent" into "A-Z" and makes the test unable to tell
  // the two sorts apart. Retroactive sessions are the only way to get genuinely distinct dates.
  async function logPastPr(page, date: string, exercise: string, weight: number, reps: number) {
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: '+ Log a past workout' }).click();

    const modal = page.getByRole('dialog');
    await modal.locator('input[type="date"]').fill(date);
    await modal.locator('input[type="time"]').fill('09:00');
    await modal.getByRole('button', { name: 'Start adding sets' }).click();
    await expect(page.getByText('Editing past session')).toBeVisible();

    await pickExercise(page, exercise);
    // logSetAt rather than a bare setStepper pair: the draft is re-seeded when the summary queries
    // settle and will otherwise stomp the weight between typing it and submitting, logging the set
    // at the 45 lb default (see its comment). Every set here is its exercise's first ever, so the
    // celebration fires even for a retroactive session -- it keys off the server's isPR, not
    // live-vs-past.
    await logSetAt(page, weight, reps);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/app\/history/);
  }

  // Dates, names and weights are chosen so all three sorts give DIFFERENT orders -- with the
  // obvious data two of them coincide and the test would pass while the sort key was ignored.
  //   dates    Jan 10 / Jan 20 / Feb 01  =>  recent:  Bench, Deadlift, Squat
  //   names                              =>  A-Z:     Squat("Back"), Bench, Deadlift
  //   est 1RM  247.5 / 336 / 234.3       =>  1RM:     Deadlift, Squat, Bench
  test('orders by most recent PR, name, or estimated 1RM', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await logPastPr(page, '2026-01-10', 'Barbell Back Squat', 225, 3); // 225 * (1 + 3/30) = 247.5
    await logPastPr(page, '2026-01-20', 'Barbell Deadlift', 315, 2); //   315 * (1 + 2/30) = 336
    await logPastPr(page, '2026-02-01', 'Barbell Bench Press', 185, 8); // 185 * (1 + 8/30) = 234.3

    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByText('Barbell Deadlift')).toBeVisible();

    // Default: newest PR first, which is what the removed Trends card was for.
    await expect.poll(async () => await boardOrder(page)).toEqual([
      expect.stringContaining('Barbell Bench Press'),
      expect.stringContaining('Barbell Deadlift'),
      expect.stringContaining('Barbell Back Squat'),
    ]);

    await page.getByLabel('Sort').selectOption('name');
    await expect.poll(async () => await boardOrder(page)).toEqual([
      expect.stringContaining('Barbell Back Squat'),
      expect.stringContaining('Barbell Bench Press'),
      expect.stringContaining('Barbell Deadlift'),
    ]);

    // Epley, not raw weight: the 315x2 deadlift leads, and the 185x8 bench places last despite
    // the squat being the lighter bar.
    await page.getByLabel('Sort').selectOption('est1rm');
    await expect.poll(async () => await boardOrder(page)).toEqual([
      expect.stringContaining('Barbell Deadlift'),
      expect.stringContaining('Barbell Back Squat'),
      expect.stringContaining('Barbell Bench Press'),
    ]);

    // The choice is per-person state, so it has to survive leaving the tab and coming back --
    // unlike the search/tag filter beside it, which deliberately clears.
    await page.getByRole('link', { name: 'Log' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByLabel('Sort')).toHaveValue('est1rm');
  });
});
