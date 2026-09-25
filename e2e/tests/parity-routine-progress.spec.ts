import { expect, Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addExerciseToRoutine, dismissPrCelebration } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

const BENCH = 'Barbell Bench Press';
const PRESS = 'Dumbbell Overhead Press';
const SQUAT = 'Barbell Back Squat';

function pill(page: Page, name: string) {
  return page.getByTestId('routine-pills').getByRole('button', { name, exact: true });
}

// A routine pill used to turn green purely for being behind the current position, so skipping
// ahead painted every exercise before it as complete. Green now means a set was logged at that
// step (utils/routineProgress.js), and a step passed over with nothing logged reads as skipped.
//
// "Done" is derived from useSessionEntries, which folds in sets that have not synced yet -- so a
// set logged with no signal has to turn its step green immediately, by the same path as online.
// That is the claim this spec runs in every mode.
//
// The flow is the "machine was taken" case from the handbook: skip ahead, do a later exercise, go
// back to fill in the gap -- the later one must stay done, and the one never touched stays skipped.
forEachConnectivityMode<{ personName: string }>('routine pills show what was logged, not how far you got', {
  // Routine CRUD needs a connection, and starting one is client-side state, so both happen here.
  setup: async (page, request) => {
    const personName = 'Pace';
    await registerHousehold(page, request, personName);

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: 'New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await addExerciseToRoutine(page, BENCH);
    await addExerciseToRoutine(page, PRESS);
    await addExerciseToRoutine(page, SQUAT);
    await page.getByRole('button', { name: 'Save routine' }).click();
    await page.getByRole('button', { name: 'Start routine' }).click();
    await expect(page.getByText('1 of 3')).toBeVisible();
    return { personName };
  },

  act: async (page) => {
    // Skip straight past Bench and Press to Squat, and log it.
    await pill(page, SQUAT).click();
    await expect(page.getByText('3 of 3')).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1', { exact: true })).toBeVisible();

    // Go back to fill in Press.
    await pill(page, `${PRESS}, skipped`).click();
    await expect(page.getByText('2 of 3')).toBeVisible();
  },

  assert: async (page) => {
    // Squat stays done after going back; Bench was never touched, so it is skipped, not done.
    await expect(pill(page, `${SQUAT}, done`)).toBeVisible();
    await expect(pill(page, `${BENCH}, skipped`)).toBeVisible();
    await expect(pill(page, PRESS)).toHaveAttribute('aria-current', 'step');

    // Nothing is left AHEAD of Press, so the button finishes rather than revisiting Squat.
    await expect(page.getByRole('button', { name: 'Finish routine' })).toBeVisible();

    // Log Press, then finish: the toast owns up to the one step that was skipped.
    await page.getByRole('button', { name: 'Log set' }).click();
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finish routine' }).click();
    await expect(page.getByText('Routine finished — 1 skipped', { exact: true })).toBeVisible();
  },
});
