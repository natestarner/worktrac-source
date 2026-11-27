import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { searchScreen, searchTrigger } from './support/exercises';
import { holdNetwork } from './support/faults';

// The Log search screen lists the exercise LIBRARY, so it must wait for the library -- not for the
// person's own exercise list, which usually lands first. It waited on the wrong one: on lower, right
// after sign-up, the screen said "All exercises" over "No exercises yet. Add your own below." until
// the library arrived (keyboard-scroll's library test read 0 rows there, 2026-11-27).

// The library alone: never /api/people/{id}/exercises (the person's own list).
const LIBRARY = /\/api\/exercises(\?|$)/;

test('the search screen waits for the library before listing it', async ({ page, request }) => {
  const library = await holdNetwork(page, LIBRARY);
  await registerHousehold(page, request, 'Waits');
  await expect.poll(() => library.held(), { message: 'the library request is being held' }).toBeGreaterThan(0);

  await searchTrigger(page).click();
  const screen = searchScreen(page);
  await expect(screen).toBeVisible();
  // Held a moment longer than the screen's own deferred list needs to draw.
  await page.waitForTimeout(500);
  await expect(screen.getByText('No exercises yet. Add your own below.', { exact: true })).toHaveCount(0);
  await expect(screen.getByText('All exercises', { exact: true })).toHaveCount(0);

  library.release();
  await expect(screen.getByText('All exercises', { exact: true })).toBeVisible();
  await expect.poll(() => screen.locator('button[id][aria-label]').count()).toBeGreaterThan(100);
});
