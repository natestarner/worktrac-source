import { test, expect, Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { logSetButton, pickExercise } from './support/exercises';

// The Log screen must keep its portrait layout on a portrait phone, even when the keyboard makes
// the page short.
//
// Some browsers shrink the page's height when the keyboard opens (Brave on iPhone, Chrome on
// Android). Safari does not, and neither does the App Store app at iPhone sizes, which is why it
// went unseen from July to 2026-11-27. The landscape layout (index.css) was keyed on
// `orientation: landscape` alone, which only compares width to height: 390 wide and ~300 tall
// IS landscape to CSS. So tapping Weight in Brave switched the screen to two columns, the 280px+
// sets column took the whole width, and the log form was squeezed into 0px.
//
// Playwright cannot open a real keyboard. Shrinking the viewport is exactly what those browsers do
// to the page, so it stands in for one.

test.use({ viewport: { width: 390, height: 750 } });

const grid = (page: Page) => page.locator('.exercise-detail-grid');
const columns = (page: Page) => grid(page).evaluate((el) => getComputedStyle(el).gridTemplateColumns);

test.describe('Log screen with a keyboard that shrinks the page', () => {
  test('a portrait phone keeps the full-width form when the page gets short', { tag: '@critical' }, async ({ page, request }) => {
    await registerHousehold(page, request, 'Shrink');
    await pickExercise(page, 'Barbell Bench Press');
    await expect(logSetButton(page)).toBeVisible();

    await page.getByRole('textbox', { name: 'Weight' }).first().focus();

    // 390x300 is what an iPhone in Brave leaves above the keyboard and its toolbars.
    for (const height of [500, 380, 300]) {
      await page.setViewportSize({ width: 390, height });
      await expect.poll(() => columns(page), { message: `390x${height}` }).toBe('none');
      const box = await logSetButton(page).boundingBox();
      expect(box?.width ?? 0, `Log set width at 390x${height}`).toBeGreaterThan(250);
    }
  });

  test('a phone on its side still gets the two-column landscape layout', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sideways');
    await pickExercise(page, 'Barbell Bench Press');
    await expect(logSetButton(page)).toBeVisible();

    // The smallest landscape phone (iPhone SE, 667x375), and a current one (844x390).
    for (const [width, height] of [
      [667, 375],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(async () => (await columns(page)).split(' ').length, { message: `${width}x${height}` })
        .toBe(2);
    }
  });
});
