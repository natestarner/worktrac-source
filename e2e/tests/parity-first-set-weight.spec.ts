import { Page, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { backToPicker, dismissPrCelebration, pickExercise, tapLogSet, clearSearch } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// PARITY spec: how a person's FIRST set of an exercise asks for its weight, across online /
// lie-fi / hard-offline / pinned-offline from one assertion body (decided 2026-11-24).
//
//   - Weight & reps (the library's Barbell Back Squat): the box is empty, "Log set" is disabled and
//     reads "Enter a weight", "Enter 0 for bodyweight" sits under it, and a typed 0 logs it.
//   - Bodyweight (the library's Pull-up): the box is "Added (lb)", starts at 0, one tap to log.
//
// Nothing here may touch the network: the load type rides on the cached exercise catalog. Before
// this, every blank logged 0, so a new person's first barbell set was recorded as bodyweight.

const LOADED = 'Barbell Back Squat';
const BODYWEIGHT = 'Pull-up';

async function warmCatalog(page: Page) {
  const search = page.getByPlaceholder('Search all exercises');
  for (const name of [LOADED, BODYWEIGHT]) {
    await search.fill(name);
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await clearSearch(page);
}

const setRow = (page: Page, n: number) => page.getByText(`Set ${n}`, { exact: true });

forEachConnectivityMode<void>('a first set asks for a weight only where one is expected', {
  critical: ['online', 'hard-offline'],
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Brisa');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, LOADED);
  },
  act: async (page) => {
    // A loaded lift with no history: nothing to fill in, and nothing is guessed.
    const enter = page.getByRole('button', { name: 'Enter a weight' });
    await expect(enter).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('');
    await expect(page.getByText('Enter 0 for bodyweight', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Weight (lb)' }).fill('0');
    await page.getByRole('textbox', { name: 'Weight (lb)' }).press('Enter');
    await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('0');
    await expect(page.getByText('Enter 0 for bodyweight', { exact: true })).toHaveCount(0);
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(setRow(page, 1)).toBeVisible();

    // A bodyweight exercise: 0 under "Added", logged in one tap.
    await backToPicker(page);
    await pickExercise(page, BODYWEIGHT);
    await expect(page.getByRole('textbox', { name: 'Added (lb)' })).toHaveValue('0');
    await expect(page.getByRole('button', { name: 'Enter a weight' })).toHaveCount(0);
    await tapLogSet(page);
    await dismissPrCelebration(page);
  },
  assert: async (page) => {
    await expect(setRow(page, 1)).toBeVisible();
    await expect(page.getByText('BW × 8')).toBeVisible();
    // After the first set, the next one fills in from it: no asking again.
    await expect(page.getByRole('button', { name: 'Log set' })).toBeEnabled();
  },
  afterReconnect: async (page) => {
    await backToPicker(page);
    await pickExercise(page, LOADED);
    await expect(page.getByRole('button', { name: 'Log set' })).toBeEnabled();
    await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('0');
  },
});
