import { test, expect, type Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { backToPicker, dismissPrCelebration, pickExercise, logSetAt } from './support/exercises';
import { goHardOffline, goOnline } from './support/offline';
import { expectHistoryMatchesServer } from './support/historyConvergence';

// Two writes to workouts in DIFFERENT months that reach the server back to back -- here, both queued
// offline and drained together on reconnect -- must both reach History.
//
// Each write refreshes History with a sync scoped to its own workout's months, and each refresh
// cancels the History fetch before it. As first shipped (#355) the second refresh asked only about
// ITS month, so the first write's month was never re-read: History kept the old copy, marked fresh,
// until the next ordinary sync. The fix (lib/queryClient.js#refreshHistory) keeps a scope owed until
// a refresh that carried it succeeds.
//
// Every History sync answers 2s late here, so the first write's sync is certainly still in flight
// when the second write lands -- the overlap the drain produces on a slow connection, made
// deterministic. Verified red against the refresh that captured only its own scope.

const PAST_EXERCISE = 'Barbell Deadlift';
const TODAY_EXERCISE = 'Barbell Back Squat';

// 40 days back is always a different calendar month (in UTC too) from today, and inside Free's
// 90-day window, so the household's plan does not matter.
function pastDay() {
  const d = new Date();
  d.setDate(d.getDate() - 40);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const rowFor = (page: Page, exercise: string) => page.getByRole('button', { name: `View options for ${exercise}` });

// Log opens on the picker or on the exercise last selected; wait for either before deciding.
async function toExercise(page: Page, exercise: string) {
  const picker = page.getByPlaceholder('Search all exercises');
  await expect(picker.or(page.getByRole('button', { name: /All exercises/ }))).toBeVisible();
  if (!(await picker.isVisible())) await backToPicker(page);
  await pickExercise(page, exercise);
}

// Repeats the prefilled set: any new row is a change History must show.
async function logAnotherSet(page: Page, setNumber: number) {
  await page.getByRole('button', { name: 'Log set' }).click();
  await page.waitForTimeout(300);
  await dismissPrCelebration(page);
  await expect(page.getByText(`Set ${setNumber}`, { exact: true })).toBeVisible();
}

test('two writes to different months, drained together, both reach History', async ({ page, request }) => {
  await registerHousehold(page, request, 'Owed');

  // A past workout in an earlier month, then today's -- both synced, both in History.
  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Log a past workout' }).click();
  const modal = page.getByRole('dialog');
  await modal.locator('input[type="date"]').fill(pastDay());
  await modal.locator('input[type="time"]').fill('12:00');
  await modal.getByRole('button', { name: 'Start adding sets' }).click();
  await expect(page.getByText('Adding/editing past session')).toBeVisible();
  await toExercise(page, PAST_EXERCISE);
  await logSetAt(page, 315, 3);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/app\/history/);

  await page.getByRole('link', { name: 'Log' }).click();
  await toExercise(page, TODAY_EXERCISE);
  await logSetAt(page, 225, 5);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(rowFor(page, PAST_EXERCISE)).toBeVisible();
  await expect(rowFor(page, TODAY_EXERCISE)).toBeVisible();

  await page.route('**/history/sync', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({ response });
  });

  // Offline: a set into the past workout, then one into today's. Both queue, in that order.
  await goHardOffline(page);
  const pastBlock = page
    .locator('div')
    .filter({ has: rowFor(page, PAST_EXERCISE) })
    .filter({ has: page.getByRole('button', { name: 'Edit', exact: true }) })
    .last();
  await pastBlock.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByText('Adding/editing past session')).toBeVisible();
  await toExercise(page, PAST_EXERCISE);
  await logAnotherSet(page, 2);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/app\/history/);

  await page.getByRole('link', { name: 'Log' }).click();
  await toExercise(page, TODAY_EXERCISE);
  await logAnotherSet(page, 2);

  // Reconnect: the outbox drains both, and each write's History refresh overlaps the other's.
  await goOnline(page);
  await expectHistoryMatchesServer(page, request);
  await expect(page.getByText('315lb×3')).toHaveCount(2);
});
