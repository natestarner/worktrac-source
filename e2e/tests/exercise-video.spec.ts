import { Page, expect, test } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { goHardOffline } from './support/offline';
import { forEachConnectivityMode } from './support/parity';

// The how-to video on a library exercise: a play button in the strip's last slot, opening a sheet
// that holds the video alone (the strip's body opens the muscles alone -- one icon, one sheet,
// 2026-11-08). The video loads only on a tap.
//
// Library videos arrive by migration (V97 and later), and the app reads them from the catalog. These
// pin Barbell Bench Press's video by rewriting the catalog response -- exactly the shape
// GET /api/exercises sends (ExerciseVideoDto) -- so the spec does not depend on which id a migration
// chose. The embed page is answered with a stub, so no test ever reaches YouTube.

const EXERCISE = 'Barbell Bench Press';
const VIDEO = { provider: 'youtube', videoId: 'j7ULT6dznNc', startSeconds: 12, sourceLabel: 'Muscle & Strength' };
const WATCH = 'Show how-to video';

async function giveBenchAVideo(page: Page) {
  await page.route('**/api/exercises', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    let response;
    try {
      response = await route.fetch();
    } catch {
      return route.abort();
    }
    const rows = await response.json();
    for (const row of rows) if (row.name === EXERCISE) row.video = VIDEO;
    await route.fulfill({ response, json: rows });
  });
  await page.route('**/embed/youtube.html**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Stub player</title><p>Stub player</p>' }),
  );
}

// Makes sure the catalog (with the video) is in the cache before anything cuts the network.
async function warmCatalog(page: Page) {
  const search = page.getByPlaceholder('Search all exercises');
  await search.fill(EXERCISE);
  await expect(page.getByRole('button', { name: EXERCISE, exact: true })).toBeVisible();
  await search.fill('');
}

// PARITY: the button and the sheet come from the cached catalog, so they are the same in every
// mode. What the video card shows INSIDE differs offline, by design (resilience.md's register), so
// this asserts only what is the same: the section, in view with no muscles beside it, and who made
// the video.
forEachConnectivityMode<void>('a library exercise’s how-to video opens from the strip in any mode', {
  setup: async (page, request) => {
    await giveBenchAVideo(page);
    await registerHousehold(page, request, 'Clonmel');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await page.getByRole('button', { name: WATCH }).click();
  },
  assert: async (page) => {
    const sheet = page.getByRole('dialog', { name: EXERCISE });
    await expect(sheet).toBeVisible();
    const video = sheet.getByRole('region', { name: 'How-to video' });
    await expect(video).toBeInViewport();
    await expect(sheet.getByRole('group', { name: 'Body diagram' })).toHaveCount(0);
    await expect(sheet.getByText('Main muscles')).toHaveCount(0);
    await expect(video.getByText('Video: Muscle & Strength on YouTube.')).toBeVisible();
    await expect(video.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=j7ULT6dznNc&t=12s',
    );
    // Closed here: leaving pinned-offline goes through the offline banner, which the scrim covers.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  },
});

test.describe('the how-to video', () => {
  test.beforeEach(async ({ page, request }) => {
    await giveBenchAVideo(page);
    await registerHousehold(page, request, 'Mitchelstown');
    await warmCatalog(page);
  });

  test('loads nothing until played, then plays this app’s own embed page, muted', async ({ page }) => {
    const embedRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/embed/youtube.html')) embedRequests.push(r.url());
    });
    await pickExercise(page, EXERCISE);
    await page.getByRole('button', { name: WATCH }).click();
    const sheet = page.getByRole('dialog', { name: EXERCISE });
    await expect(sheet.getByRole('button', { name: 'Play the video' })).toBeVisible();
    expect(embedRequests).toEqual([]);

    await sheet.getByRole('button', { name: 'Play the video' }).click();
    const frame = sheet.locator('iframe[title="How-to video: Barbell Bench Press"]');
    await expect(frame).toHaveAttribute('src', '/embed/youtube.html?v=j7ULT6dznNc&start=12&mute=1');
    await expect(page.frameLocator('iframe[title="How-to video: Barbell Bench Press"]').getByText('Stub player')).toBeVisible();

    // Closing the sheet takes the player with it, which is what stops the video.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  // The register's one row for this feature: offline, the player is replaced by a sentence.
  test('says it needs a connection when offline, instead of a player that cannot load', async ({ page }) => {
    await pickExercise(page, EXERCISE);
    await goHardOffline(page);
    await page.getByRole('button', { name: WATCH }).click();
    const sheet = page.getByRole('dialog', { name: EXERCISE });
    await expect(sheet.getByText('The video needs a connection.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Play the video' })).toHaveCount(0);
  });

  test('the body opens the muscles without the video', async ({ page }) => {
    await pickExercise(page, EXERCISE);
    await page.getByRole('button', { name: /^About this exercise/ }).click();
    const sheet = page.getByRole('dialog', { name: EXERCISE });
    await expect(sheet.getByRole('group', { name: 'Body diagram' })).toBeVisible();
    await expect(sheet.getByRole('region', { name: 'How-to video' })).toHaveCount(0);
  });

  // The X must be on screen the moment a sheet opens, on a phone held upright. On iOS Safari the
  // combined sheet's scroll-to-video pushed the header above the screen with no way back to it.
  test('each sheet opens with its Close button on screen at phone size', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await pickExercise(page, EXERCISE);
    for (const opener of [WATCH, /^About this exercise/]) {
      await page.getByRole('button', { name: opener }).click();
      const close = page.getByRole('dialog', { name: EXERCISE }).getByRole('button', { name: 'Close' });
      await expect(close).toBeInViewport({ ratio: 1 });
      await close.click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });

  // No video: play struck through, never an empty slot, and it says so rather than doing nothing.
  test('an exercise with no video shows play struck through, which says there is none', async ({ page }) => {
    // Hammer Curl has no video: Muscle & Strength's clip for it is a site-locked Vimeo
    // (docs/exercise-videos/README.md).
    await pickExercise(page, 'Hammer Curl');
    await expect(page.getByRole('button', { name: /^About this exercise/ })).toBeVisible();
    await expect(page.getByRole('button', { name: WATCH })).toHaveCount(0);
    await page.getByRole('button', { name: 'No how-to video' }).click();
    const sheet = page.getByRole('dialog', { name: 'Hammer Curl' });
    await expect(sheet.getByText('There’s no how-to video for this exercise yet.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Play the video' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
