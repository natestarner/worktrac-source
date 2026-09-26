import { test, expect, type Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise, logSetAt } from './support/exercises';
import { watchSync } from './support/historyConvergence';

// The whole History is re-downloaded only when the person asks (lib/historyReload.js): a reload while
// on History, or a pull down on it in the installed app. Everything else syncs by fingerprint and
// trusts what the device holds. A full download is a sync offering no months (`held` empty).

async function historyWithOneSet(page: Page, request: Parameters<typeof registerHousehold>[1]) {
  const sync = await watchSync(page);
  await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Barbell Bench Press');
  const mark = await sync.mark();
  await logSetAt(page, 135, 5);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  await sync.persistedSince(mark);
  return sync;
}

async function fullSyncsAfterSettling(sync: Awaited<ReturnType<typeof watchSync>>, page: Page) {
  const fresh = { started: 0, calls: 0 };
  await expect.poll(() => sync.settledSince(fresh)).toBe(true);
  await page.waitForTimeout(1500); // anything still to come from the boot warm or a mounting screen
  await expect.poll(() => sync.settledSince(fresh)).toBe(true);
  return (await sync.callsSince(fresh)).filter((c) => c.held.length === 0);
}

test('reloading on History downloads it in full, once; reloading another tab and switching back does not', async ({ page, request }) => {
  const sync = await historyWithOneSet(page, request);

  await page.reload();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  expect(await fullSyncsAfterSettling(sync, page)).toHaveLength(1);

  await page.getByRole('link', { name: 'Log', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/log/);
  await page.reload();
  await expect(page.getByRole('link', { name: 'History' })).toBeVisible();
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  expect(await fullSyncsAfterSettling(sync, page)).toHaveLength(0);
});

test.describe('in the installed app', () => {
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'real touch input is driven through the Chrome DevTools Protocol');
    // The Home Screen app: standalone display mode, which a Playwright page cannot be launched in.
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query.includes('display-mode: standalone') ? ({ matches: true } as MediaQueryList) : original(query);
    });
  });

  test('pulling down from the top of History downloads it in full; a short pull does not', async ({ page, request }) => {
    const sync = await historyWithOneSet(page, request);
    const cdp = await page.context().newCDPSession(page);
    const box = (await page.getByText(/135\s?lb\s?×\s?5/).first().boundingBox())!;
    const pull = async (distance: number) => {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (distance * i) / 8 }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await sync.mark();

    await pull(40);
    await page.waitForTimeout(1000);
    expect((await sync.callsSince(before)).filter((c) => c.held.length === 0)).toHaveLength(0);

    await pull(160);
    await expect.poll(async () => (await sync.callsSince(before)).filter((c) => c.held.length === 0).length).toBe(1);
    await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  });

  // The same refresh for anyone who can't pull: a control that appears when focused.
  test('the Refresh History control downloads it in full', async ({ page, request }) => {
    const sync = await historyWithOneSet(page, request);
    const before = await sync.mark();

    // Tabbed to, as a keyboard user reaches it: it is off-screen until focused by keyboard.
    const control = page.getByRole('button', { name: 'Refresh History' });
    for (let i = 0; i < 40 && !(await control.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(control).toBeFocused();
    await expect(control).toBeInViewport();
    await page.keyboard.press('Enter');

    await expect.poll(async () => (await sync.callsSince(before)).filter((c) => c.held.length === 0).length).toBe(1);
  });
});
