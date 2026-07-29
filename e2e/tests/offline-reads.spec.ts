import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { goHardOffline, goOnline, offlineSavedLocallyBanner } from './support/offline';
import { failNetwork } from './support/faults';

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

// PRs is now part of the warmed bundle (offlineCacheWarm.js), not purely interaction-scoped, so
// it must survive a connectivity drop the same way History already does above -- both hard
// offline and "lie-fi" (online per navigator.onLine, but the request itself fails).
test.describe('Offline mode — PRs reads over the warmed cache', () => {
  test('PRs with a real logged set resolves hard offline', async ({ page, request }) => {
    await registerHousehold(page, request, 'Marlowe');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)

    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    await goHardOffline(page);
    // Navigate away and back (client-side, no full reload) to force the PRs query to remount
    // and prove it resolves from the warmed cache with no network.
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('link', { name: 'PRs' }).click();

    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
    await goOnline(page);
  });

  test('PRs with a real logged set resolves during lie-fi (fetch attempted but fails)', async ({ page, request }) => {
    await registerHousehold(page, request, 'Adair');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true });

    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    // Stays online per navigator.onLine, but the request itself fails -- TanStack keeps the
    // last-good warmed data on screen instead of clearing it just because a background
    // refetch (triggered by this remount) fails.
    await failNetwork(page, /\/api\/people\/\d+\/prs$/);
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('link', { name: 'PRs' }).click();

    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
  });
});

// Exercise Detail's "Last time"/"Best est. 1RM" card is interaction-scoped
// (queryKeys.exerciseSummary is keyed on personId + exerciseId + contextSessionId), so it's
// realistic to open a given (exercise, no-live-session) combination for the first time while
// the live query can't get an answer -- either genuinely offline, or online-but-unreachable
// ("lie-fi"). Both must resolve from the already-warmed history cache
// (exerciseSummaryFromHistory.js) instead of hanging or falsely showing "No sets yet"/"No PR yet".
test.describe('Offline mode — Exercise Detail summary derived from warmed history', () => {
  async function logSetAndEndWorkout(page, personName) {
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();
    // Ending a workout from the exercise screen returns you to the Log picker automatically.
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();
    // Confirm liveSession has genuinely settled to "none" (the person-pill's live-session dot
    // clears -- same signal reload-persistence.spec.ts uses) before a caller cuts the
    // connection. The picker rendering doesn't itself prove this: a not-yet-corrected "still
    // live" snapshot would freeze that way forever offline (a paused query can never revalidate
    // it away), wrongly excluding this very session from "Last time" on the next visit.
    await expect(personPill(page, personName).locator('span')).toHaveCount(1);
  }

  test('derives Last time/Best est. 1RM hard offline for an (exercise, no-live-session) key never fetched before', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'Ellery');
    await logSetAndEndWorkout(page, 'Ellery');

    await goHardOffline(page);
    await expect(offlineSavedLocallyBanner(page)).toBeVisible();

    // The only prior visit to this exercise's detail screen was mid-session (a live-session-keyed
    // cache entry) -- opening it again now (no live session) queries a genuinely new cache key.
    await pickExercise(page, 'Barbell Bench Press');

    // exact: true -- "45lb×8" is also a substring of the Best card's "57 lb  (45lb×8)".
    await expect(page.getByText('45lb×8', { exact: true })).toBeVisible(); // "Last time"
    await expect(page.getByText(/57 lb/)).toBeVisible(); // "Best · Est. 1RM"
    await goOnline(page);
  });

  test('derives Last time/Best est. 1RM during lie-fi for the same never-fetched key', async ({ page, request }) => {
    await registerHousehold(page, request, 'Frankie');
    await logSetAndEndWorkout(page, 'Frankie');

    // Stays online per navigator.onLine, but the summary fetch itself fails -- simulating an
    // unreachable backend. This is the exact cache key that's never been fetched before.
    await failNetwork(page, /\/api\/people\/\d+\/exercises\/\d+\/summary/);
    await pickExercise(page, 'Barbell Bench Press');

    // The real query client retries twice with backoff (~3s) before settling into isError --
    // give this room past the default 5s timeout rather than racing that backoff window.
    // exact: true -- "45lb×8" is also a substring of the Best card's "57 lb  (45lb×8)".
    await expect(page.getByText('45lb×8', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/57 lb/)).toBeVisible();
  });
});
