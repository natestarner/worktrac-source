import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { goHardOffline, offlineSavedLocallyBanner } from './support/offline';

function personPill(page, name: string) {
  return page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) });
}

// Mode 3 reads: search, History, and switching the active person all read from the warmed
// query cache offline (see offlineCacheWarm.js / useOfflineCacheWarming.js) -- distinct from
// offline-cache-warming.spec.ts's focus on a person who was never visited before going offline.
test.describe('Offline mode — reads over the warmed cache', () => {
  test('searching the exercise catalog works offline', async ({ page, request }) => {
    const catalogLoaded = page.waitForResponse((response) => /\/api\/exercises$/.test(response.url()));
    await registerHousehold(page, request, 'Harper');
    // Wait for the catalog's own initial fetch to land before cutting the connection -- it's
    // what backs the search below, and going offline before it resolves would race it.
    await catalogLoaded;

    await goHardOffline(page);
    await expect(offlineSavedLocallyBanner(page)).toBeVisible();

    await page.getByPlaceholder('Search all exercises').fill('Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Barbell Bench Press', exact: true })).toBeVisible();
  });

  test('History with real logged data resolves offline', async ({ page, request }) => {
    await registerHousehold(page, request, 'Indigo');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    await goHardOffline(page);
    // Navigate away and back (client-side, no full reload -- reload-while-offline needs the
    // production service worker, see offline-mode.spec.ts) to force History's query to remount
    // and prove it resolves from the warmed cache with no network.
    await page.getByRole('link', { name: 'PRs' }).click();
    await page.getByRole('link', { name: 'History' }).click();

    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
    await expect(page.getByText('45lb×8')).toBeVisible();
  });

  test('switching the active person offline serves each one their own warmed data with no leak', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jules');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Kit');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await goHardOffline(page);
    await expect(offlineSavedLocallyBanner(page)).toBeVisible();

    // Kit (just added, active now) has never logged anything -- their own empty History, not
    // Jules's set.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('No workouts logged yet for Kit.')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toBeHidden();

    // Switching back to Jules offline still shows Jules's own real history.
    await personPill(page, 'Jules').click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
    await expect(page.getByText('No workouts logged yet for Jules.')).toBeHidden();
  });
});
