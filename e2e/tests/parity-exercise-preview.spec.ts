import { Page, expect, test } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addExerciseToRoutine, logSetAt, pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// "Preview exercise": an exercise's muscles (and how-to video, where it has one) BEFORE choosing
// it, from the picker's search, History's and PRs' per-exercise menu, and the routine editor.
// components/exercise/ExercisePreview.jsx.
//
// PARITY for the picker, where it matters most (an unfamiliar exercise found by searching the
// whole library): everything comes from the cached catalog, so every mode shows the same muscles
// and no mode chooses the exercise. If an assertion ever needs to branch on ctx.mode, that is a
// divergence for resilience.md's register, not an `if`.

const EXERCISE = 'Barbell Bench Press';

// The search result row and its preview button share a wrapper; the button's name never contains
// the exercise's (ExerciseSearchResults.jsx explains why), so it is found through its row.
function previewButtonFor(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true }).locator('xpath=..').getByRole('button', { name: 'Preview exercise' });
}

async function expectBenchMuscles(scope: ReturnType<Page['getByRole']>) {
  await expect(scope.getByText('Main muscles')).toBeVisible();
  await expect(scope.getByText('Chest', { exact: true })).toBeVisible();
  await expect(scope.getByText('Triceps', { exact: true })).toBeVisible();
}

forEachConnectivityMode<void>('previewing a search result shows its muscles without choosing it', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Kenmare');
    // Warm the catalog while online, as any device that has opened the picker has.
    const search = page.getByPlaceholder('Search all exercises');
    await search.fill(EXERCISE);
    await expect(page.getByRole('button', { name: EXERCISE, exact: true })).toBeVisible();
    await search.fill('');
  },
  navigate: async () => {},
  act: async (page) => {
    await page.getByPlaceholder('Search all exercises').fill(EXERCISE);
    await previewButtonFor(page, EXERCISE).click();
  },
  assert: async (page) => {
    const sheet = page.getByRole('dialog', { name: EXERCISE });
    await expect(sheet).toBeVisible();
    await expectBenchMuscles(sheet);
    // A preview is not an edit: nothing here changes what the exercise works.
    await expect(sheet.getByRole('button', { name: 'Add muscles worked' })).toHaveCount(0);

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Still on the picker, still searching: previewing did not choose the exercise.
    await expect(page.getByPlaceholder('Search all exercises')).toHaveValue(EXERCISE);
    await expect(page.getByRole('button', { name: 'Log set' })).toHaveCount(0);
    // Leave the picker as found: the harness ends on the tab bar.
    await page.getByPlaceholder('Search all exercises').fill('');
  },
});

test.describe('previewing an exercise from elsewhere', () => {
  test('History’s per-exercise menu opens its muscles', async ({ page, request }) => {
    await registerHousehold(page, request, 'Dingle');
    await pickExercise(page, EXERCISE);
    await logSetAt(page, 135, 5);
    await page.getByRole('link', { name: 'History' }).click();

    await page.getByRole('button', { name: `View options for ${EXERCISE}` }).first().click();
    await page.getByRole('button', { name: 'About this exercise' }).click();

    // The menu gives way to the sheet: one dialog at a time.
    const sheet = page.getByRole('dialog', { name: EXERCISE });
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expectBenchMuscles(sheet);
  });

  test('PRs’ per-exercise menu opens its muscles', async ({ page, request }) => {
    await registerHousehold(page, request, 'Cobh');
    await pickExercise(page, EXERCISE);
    await logSetAt(page, 135, 5);
    await page.getByRole('link', { name: 'PRs' }).click();

    await page.getByTestId('pr-row').filter({ hasText: EXERCISE }).first().click();
    await page.getByRole('button', { name: 'About this exercise' }).click();

    const sheet = page.getByRole('dialog', { name: EXERCISE });
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expectBenchMuscles(sheet);
  });

  test('the routine editor shows it in place, and keeps the routine being built', async ({ page, request }) => {
    await registerHousehold(page, request, 'Athy');
    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: 'New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await addExerciseToRoutine(page, 'Barbell Overhead Press');

    await page.getByPlaceholder('Search all exercises').fill(EXERCISE);
    await previewButtonFor(page, EXERCISE).click();

    // Inside the same dialog, never a second one on top.
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const dialog = page.getByRole('dialog', { name: EXERCISE });
    await expectBenchMuscles(dialog);

    await dialog.getByRole('button', { name: '← Back to the routine' }).click();
    await expect(page.getByRole('dialog', { name: 'New routine' })).toBeVisible();
    await expect(page.getByPlaceholder('Routine name (e.g. Push Day)')).toHaveValue('Push Day');
    await expect(page.getByText('In this routine')).toBeVisible();
    await expect(page.getByPlaceholder('Search all exercises')).toHaveValue(EXERCISE);

    // And previewing did not add it.
    await page.getByRole('button', { name: 'Save routine' }).click();
    await expect(page.getByText('Push Day', { exact: true })).toBeVisible();
    await expect(page.getByText('Barbell Overhead Press', { exact: true })).toBeVisible();
  });
});
