import { expect, type Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { logSetAt, pickExercise } from './support/exercises';
import { waitForOutboxDrain } from './support/offline';
import { forEachConnectivityMode } from './support/parity';
import { turnOnMuscleHighlighter } from './support/muscleMap';

// The Trends muscle map counts sets per muscle from the History this device holds, with the workout
// in progress folded in -- queued sets included -- and each exercise's muscles from the cached
// catalog (utils/muscleSets.js). So sets logged in ANY mode are on the map at once, by one code
// path. Barbell Bench Press mainly works the chest and is helped by the shoulders and triceps:
// three sets are 3 for the chest and 1.5 for each helper.

const EXERCISE = 'Barbell Bench Press';

async function openTrends(page: Page) {
  await page.getByRole('link', { name: 'Trends' }).click();
  await expect(page).toHaveURL(/\/app\/trends/);
  await expect(page.getByText('Trends need a connection')).toBeHidden();
}

function muscleRows(page: Page) {
  return page.getByRole('list', { name: 'Sets per muscle' }).getByRole('listitem');
}

// The library sets a shaded outline's strength as its inline opacity. The map shades relative to
// the most-worked muscle: the chest (the most) is 0.9, a muscle with half its sets is 0.5.
async function shading(page: Page, body: string, muscleId: string) {
  return page
    .getByTestId('muscle-map')
    .getByRole('img', { name: body })
    .locator(`.mm-muscle-layer path[data-muscle-id="${muscleId}"]`)
    .first()
    .evaluate((el) => (el as SVGElement).style.opacity)
    .catch(() => null);
}

async function expectThreeSetsOfBench(page: Page) {
  await expect(muscleRows(page)).toHaveText(['Chest3 sets', 'Shoulders1.5 sets', 'Triceps1.5 sets']);
  await expect.poll(() => shading(page, 'Front of the body, shaded by sets per muscle', 'pectoralis')).toBe('0.9');
  await expect.poll(() => shading(page, 'Back of the body, shaded by sets per muscle', 'triceps')).toBe('0.5');
}

forEachConnectivityMode<void>('sets logged in any mode are on the Trends muscle map at once', {
  async setup(page, request) {
    await registerHousehold(page, request, 'Mallow');
    // Off by default (V102); this spec asserts the bodies' shading.
    await turnOnMuscleHighlighter(page);
    await pickExercise(page, EXERCISE);
    await logSetAt(page, 135, 5);
    await waitForOutboxDrain(page);
    // The baseline set is in History, and on the map, before any mode cuts the network.
    await openTrends(page);
    await expect(muscleRows(page)).toHaveText(['Chest1 set', 'Shoulders0.5 sets', 'Triceps0.5 sets']);
    await page.waitForLoadState('networkidle');
  },

  async navigate(page) {
    await page.getByRole('link', { name: 'Log', exact: true }).click();
    const picker = page.getByPlaceholder('Search all exercises');
    await expect(picker.or(page.getByRole('button', { name: 'Log set' })).first()).toBeVisible();
    if (await picker.isVisible()) await pickExercise(page, EXERCISE);
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
  },

  // Heavier each time: logSetAt expects (and dismisses) a record on every set. The weight is
  // incidental here -- the map counts sets.
  async act(page) {
    await logSetAt(page, 145, 5);
    await logSetAt(page, 155, 5);
  },

  // Mode-independent, deliberately: this IS the parity claim.
  async assert(page) {
    await openTrends(page);
    await expectThreeSetsOfBench(page);
  },

  // Synced: the same map, read from the server's History rather than the queue.
  async afterReconnect(page) {
    await page.reload();
    await openTrends(page);
    await expectThreeSetsOfBench(page);
  },
});
