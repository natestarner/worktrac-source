import { test, expect } from '@playwright/test';
import { loginAs, registerHousehold } from './support/auth';
import { logSetAt, pickExercise } from './support/exercises';
import { failNetwork } from './support/faults';

// A device that has never held this person's History signs in while every History request fails
// (lie-fi: a gym basement, a struggling backend). History used to read "No workouts logged yet" --
// reproduced on lower with a 1,828-workout account. It must say it needs a connection instead, as
// PRs and Trends already do, and show the workouts once History can download.
//
// A second device, not the one that logged the set: the first already holds History, and a device
// that has ever held it shows what it holds (the ordinary offline case, covered elsewhere).
const HISTORY = /\/api\/people\/\d+\/history(\/sync)?$/;

test('History on a new device with no History yet says it needs a connection, never "no workouts"', async ({ page, request, browser }) => {
  const email = await registerHousehold(page, request, 'Rowan');
  await pickExercise(page, 'Barbell Bench Press');
  await logSetAt(page, 135, 5);

  const device = await browser.newContext();
  const other = await device.newPage();
  const history = await failNetwork(other, HISTORY);
  await loginAs(other, email, 'password123');
  await other.getByRole('link', { name: 'History' }).click();
  await expect.poll(() => history.count()).toBeGreaterThan(0);

  await expect(other.getByText('History needs a connection')).toBeVisible();
  await expect(other.getByText(/No workouts logged yet/)).toHaveCount(0);

  // History can download again: the workout appears, and the message goes.
  history.stop();
  await other.reload();
  await expect(other.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  await expect(other.getByText('History needs a connection')).toHaveCount(0);
  await device.close();
});
