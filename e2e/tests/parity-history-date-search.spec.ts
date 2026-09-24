import { expect, type Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { backToPicker, logSetAt, pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// History's "Search by date": tap the calendar beside the search box, pick a day, see only that
// day's workouts.
//
// Run across every connectivity mode because the whole feature is a client-side pass over the
// CACHED history -- the calendar's workout dots and the filter alike -- so there is no request
// that could fail, and nothing to branch on. That is a claim, and this spec is what makes it a
// test result: if the dots or the filter ever came to depend on a fetch, the degraded modes would
// show an empty calendar or an empty list while online still passed.
//
// Two workouts on two different days, with different exercises, so "only that day" is
// distinguishable from "everything" and from "nothing".

const PAST_EXERCISE = 'Barbell Deadlift';
const TODAY_EXERCISE = 'Barbell Back Squat';

// Three days ago: inside the Free window, never today, and possibly last month -- which the act
// handles by paging back, exercising the month navigation as a side effect.
function pastDay() {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  d.setHours(12, 0, 0, 0);
  return d;
}

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Matches dateRange.js#formatLongDate, which names every day button.
function longDay(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

const rowFor = (page: Page, exercise: string) => page.getByRole('button', { name: `View options for ${exercise}` });

forEachConnectivityMode<{ day: Date }>('History can be searched by date', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Cal');
    const day = pastDay();

    // The past workout first, while no exercise is selected on Log, so the picker is on screen
    // when the past session opens. Logging a past workout is online-only (not idempotent), which
    // is why it lives in setup and not in the mode.
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Log a past workout' }).click();
    const modal = page.getByRole('dialog');
    await modal.locator('input[type="date"]').fill(isoDay(day));
    await modal.locator('input[type="time"]').fill('09:00');
    await modal.getByRole('button', { name: 'Start adding sets' }).click();
    await expect(page.getByText('Adding/editing past session')).toBeVisible();
    await pickExercise(page, PAST_EXERCISE);
    await logSetAt(page, 315, 3);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/app\/history/);

    // Then today's workout.
    // Log may reopen on the exercise the past session last had selected, or on the picker; wait
    // for either to render before deciding, so the check is not a race against the tab switch.
    await page.getByRole('link', { name: 'Log' }).click();
    const picker = page.getByPlaceholder('Search all exercises');
    await expect(picker.or(page.getByRole('button', { name: /All exercises/ }))).toBeVisible();
    if (!(await picker.isVisible())) await backToPicker(page);
    await pickExercise(page, TODAY_EXERCISE);
    await logSetAt(page, 225, 5);

    // History, online, holding both -- the copy every mode below reads.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(rowFor(page, PAST_EXERCISE)).toBeVisible();
    await expect(rowFor(page, TODAY_EXERCISE)).toBeVisible();
    return { day };
  },

  navigate: async (page) => {
    await page.getByRole('link', { name: 'History' }).click();
    await expect(rowFor(page, TODAY_EXERCISE)).toBeVisible();
  },

  act: async (page, { day }) => {
    await page.getByRole('button', { name: 'Search by date' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a date' });
    await expect(picker).toBeVisible();

    const now = new Date();
    if (day.getMonth() !== now.getMonth()) {
      await picker.getByRole('button', { name: 'Previous month' }).click();
    }
    // Exact name, dot included: this is the parity claim for the calendar's workout marks too.
    await picker.getByRole('button', { name: `${longDay(day)}, 1 workout`, exact: true }).click();
    await expect(picker).toBeHidden();
  },

  assert: async (page) => {
    await expect(rowFor(page, PAST_EXERCISE)).toBeVisible();
    await expect(rowFor(page, TODAY_EXERCISE)).toHaveCount(0);
    await expect(page.getByText('315lb×3')).toBeVisible();

    // The chip's x brings everything back.
    await page.getByRole('button', { name: /^Stop filtering to / }).click();
    await expect(rowFor(page, TODAY_EXERCISE)).toBeVisible();
    await expect(rowFor(page, PAST_EXERCISE)).toBeVisible();
  },
});
