import { test, expect, Page, Locator } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addPerson } from './support/people';
import { addExerciseToRoutine } from './support/exercises';

// What the iPhone keyboard does to scrolling, and the one mechanism that answers it
// (frontend/src/lib/visibleViewport.js). Reported 2026-11-08, on iPhone Safari and in the App
// Store app, portrait:
//   1. The Add exercise and New routine dialogs went partly off the top of the screen once the
//      keyboard was up, and could not be scrolled back.
//   2. Focusing the Log picker's search left the top of the field (its orange focus border) under
//      the tab bar.
//   3. The first letter typed there jumped the page to the bottom of the list and back, and hid
//      "Or pick an exercise".
// 2 and 3 were fixed by scrolling the page to the field, which the App Store app's keyboard then
// defeated about half the time (#626). The search is now a full-screen layer: the field is pinned
// at the top of what is visible and the page is never scrolled at all, which is what the picker
// cases below assert.
//
// No browser here opens a software keyboard. Two shapes stand in for it:
//   - The App Store app's: the window itself shrinks above the keyboard (`Keyboard.resize:
//     "native"`), i.e. a short viewport. Driven with setViewportSize.
//   - Safari's: the window stays full height and only the VISUAL viewport shrinks and pans. A
//     Chromium page can't fake visualViewport, so the dialog spec publishes the two values the app
//     derives from it (`--visible-viewport-top` / `-height`) itself; that the app publishes them
//     from visualViewport is pinned by visibleViewport.test.js.

// iPhone portrait width, with the height left above an open keyboard.
const KEYBOARD_UP = { width: 390, height: 420 };
// The same phone with the keyboard down.
const PHONE = { width: 390, height: 844 };

// The dialog's entrance animation holds it off its resting box until it finishes (e2e-tests.md,
// "Before measuring pixels inside a Modal").
async function dialogSettled(dialog: Locator) {
  await expect
    .poll(() =>
      dialog.evaluate((el) => el.getAnimations().length === 0 && getComputedStyle(el).transform === 'none'),
    )
    .toBe(true);
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, 'element must be laid out').not.toBeNull();
  return b!;
}

// Every part of `inner` is inside the band top..bottom (1px of sub-pixel slack).
async function expectWithin(inner: Locator, top: number, bottom: number, label: string) {
  const b = await box(inner);
  expect(b.y, `${label}: top edge is above the visible area`).toBeGreaterThanOrEqual(top - 1);
  expect(b.y + b.height, `${label}: bottom edge is below the visible area`).toBeLessThanOrEqual(bottom + 1);
}

async function twoPersonHousehold(page: Page, request: Parameters<typeof registerHousehold>[1]) {
  await registerHousehold(page, request, 'Jordan');
  // Two people put the person bar INSIDE the sticky chrome: the taller (~141px) case the old fixed
  // 132px clearance undershot.
  await addPerson(page, 'Sam');
  await page.getByRole('button', { name: 'Jordan', exact: true }).click();
}

test.describe('the keyboard and scrolling', () => {
  test('a dialog fits above the keyboard in the app, header and first field visible', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');
    await page.setViewportSize(KEYBOARD_UP);
    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: 'New routine' }).click();

    const dialog = page.getByRole('dialog');
    await dialogSettled(dialog);
    await expectWithin(dialog, 0, KEYBOARD_UP.height, 'routine dialog');
    await expectWithin(dialog.getByRole('button', { name: 'Close' }), 0, KEYBOARD_UP.height, 'close button');
    await expectWithin(page.getByPlaceholder('Routine name (e.g. Push Day)'), 0, KEYBOARD_UP.height, 'name field');

    // Everything else is reachable by scrolling the dialog itself.
    const footer = dialog.getByRole('button', { name: 'Save routine' });
    await footer.scrollIntoViewIfNeeded();
    await expectWithin(footer, 0, KEYBOARD_UP.height, 'save button');
  });

  test("a dialog follows Safari's view when the keyboard pans it", async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    const dialog = page.getByRole('dialog');
    await dialogSettled(dialog);

    // Safari with the keyboard up: the visible part is 250..610 of a full-height page.
    await page.evaluate(() => {
      const root = document.documentElement.style;
      root.setProperty('--visible-viewport-top', '250px');
      root.setProperty('--visible-viewport-height', '360px');
    });
    await expectWithin(dialog, 250, 610, 'add exercise dialog');
    await expectWithin(dialog.getByRole('button', { name: 'Close' }), 250, 610, 'close button');
    await expectWithin(dialog.getByRole('textbox').first(), 250, 610, 'name field');
  });

  // Records window.scrollY and the field's top on every frame until stopped. A retrying matcher
  // would wait out a page that moved and came back; samples cannot.
  async function startSampling(page: Page) {
    await page.evaluate(() => {
      const field = document.querySelector('input[placeholder="Search all exercises"]')!;
      const w = window as unknown as { __samples: { scrollY: number; top: number }[]; __sampling: boolean };
      w.__samples = [];
      w.__sampling = true;
      const sample = () => {
        w.__samples.push({ scrollY: Math.round(window.scrollY), top: Math.round(field.getBoundingClientRect().top) });
        if (w.__sampling) requestAnimationFrame(sample);
      };
      sample();
    });
  }
  async function stopSampling(page: Page) {
    return page.evaluate(() => {
      const w = window as unknown as { __samples: { scrollY: number; top: number }[]; __sampling: boolean };
      w.__sampling = false;
      return w.__samples;
    });
  }

  // #626: on TestFlight the page sometimes refused to scroll the field to the top (the App Store
  // app's window shrinks as the keyboard opens, and the scroll clamped). The search now opens a
  // fixed layer, so the field is at the top without the page moving at all.
  test('tapping the search opens a full-screen layer: field at the top, results above the keyboard, page never scrolled', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    // The tap lands on a FULL-height phone screen; the keyboard (the app's window shrinking above
    // it) arrives after. That order is what defeated the old scroll.
    await page.setViewportSize(PHONE);
    const search = page.getByPlaceholder('Search all exercises');
    await expect(search).toHaveValue('');
    await page.evaluate(() => window.scrollTo(0, 0));
    const restingTop = Math.round((await box(search)).y);

    await startSampling(page);
    await search.click();
    await page.setViewportSize(KEYBOARD_UP);
    const layer = page.getByRole('dialog', { name: 'Exercise search' });
    await expect(layer).toBeVisible();
    await search.pressSequentially('press');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();
    await page.waitForTimeout(400); // a few more frames, for any scroll the tap or typing set off
    const samples = await stopSampling(page);

    // The page itself never moved, on any frame.
    expect(samples.length, 'the sampler must have run').toBeGreaterThan(3);
    for (const { scrollY } of samples) expect(scrollY, 'the page scrolled').toBe(0);

    // The layer fills what is visible above the keyboard, and the field is at its top, over the chrome.
    await expect(search).toBeFocused();
    await expectWithin(layer, 0, KEYBOARD_UP.height, 'search layer');
    expect(Math.round((await box(layer)).height), 'the layer is the visible viewport').toBe(KEYBOARD_UP.height);
    expect(Math.round((await box(search)).y), 'the field is pinned at the top of the screen').toBeLessThanOrEqual(24);

    // The results scroll inside the layer, and the last control in them can be brought above the
    // keyboard without moving the page.
    const add = layer.getByRole('button', { name: '+ Add your own exercise' });
    await add.scrollIntoViewIfNeeded();
    await expectWithin(add, 0, KEYBOARD_UP.height, 'last control in the results');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Cancel puts the page back exactly as it was. The typed search stays in the field: it is the
    // person's draft.
    await page.setViewportSize(PHONE);
    await layer.getByRole('button', { name: 'Cancel' }).click();
    await expect(layer).toHaveCount(0);
    await expect(search).toHaveValue('press');
    await expect(search).not.toBeFocused();
    expect(Math.round((await box(search)).y)).toBe(restingTop);
  });

  // 2026-11-26, on lower: in the App Store app the results could not be scrolled at all, and in
  // Safari the layer flickered while the page behind it moved. The layer was sized and placed from
  // visualViewport in JS (`--visible-viewport-*`), so it chased Safari's pans a frame late, and a
  // stale height (iOS 26 reports stale visualViewport values around the keyboard) left it taller
  // than the app's window -- the results then fit inside it, had nothing to scroll, and ran on
  // under the keyboard. It is now pinned to the window with `inset: 0`, which the browser keeps
  // right on every frame. Both cases make visualViewport itself report what iOS reports, so the
  // app's own tracker publishes it: red against the old CSS.
  async function visualViewportReports(page: Page, report: { offsetTop: number; height: number }) {
    await page.evaluate((r) => {
      const vv = window.visualViewport!;
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => r.offsetTop });
      Object.defineProperty(vv, 'height', { configurable: true, get: () => r.height });
      vv.dispatchEvent(new Event('resize'));
    }, report);
    // The tracker publishes on the next frame.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--visible-viewport-height')))
      .toBe(`${report.height}px`);
  }

  test('the search layer is the window, whatever visualViewport says, and its results scroll', async ({ page, request, isMobile }) => {
    await twoPersonHousehold(page, request);
    await page.setViewportSize(PHONE);
    const search = page.getByPlaceholder('Search all exercises');
    await search.click();
    const layer = page.getByRole('dialog', { name: 'Exercise search' });
    await expect(layer).toBeVisible();
    await search.pressSequentially('press');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();

    // The app: the window shrinks above the keyboard, but a stale value still says full height.
    await page.setViewportSize(KEYBOARD_UP);
    await visualViewportReports(page, { offsetTop: 0, height: PHONE.height });
    const appBox = await box(layer);
    expect(Math.round(appBox.y), 'the layer starts at the top of the window').toBe(0);
    expect(Math.round(appBox.height), 'the layer ends at the bottom of the window (the keyboard)').toBe(KEYBOARD_UP.height);
    const results = layer.locator('.exercise-search-results');
    const overflow = await results.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(overflow.scroll, 'the results overflow their box, so a finger can scroll them').toBeGreaterThan(overflow.client);
    // Scrolling the results moves them and not the page: a real wheel where there is one (mobile
    // WebKit has none, e2e-tests.md), else a scroll from inside the page.
    if (isMobile) {
      await results.evaluate((el) => el.scrollBy(0, 300));
    } else {
      const r = await box(results);
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await page.mouse.wheel(0, 300);
    }
    await expect.poll(() => results.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Safari: a full-height window with the keyboard over its bottom, and the view panned down.
    // The layer stays put (the pan is what it used to chase), and the end of the results can still
    // be scrolled above the keyboard because the list pads its end by the keyboard's height.
    await page.setViewportSize(PHONE);
    // Visible 250..610 of an 844px window: the keyboard covers the bottom 234px.
    await visualViewportReports(page, { offsetTop: 250, height: 360 });
    const safariBox = await box(layer);
    expect(Math.round(safariBox.y), 'the layer does not chase the pan').toBe(0);
    expect(Math.round(safariBox.height)).toBe(PHONE.height);
    await expectWithin(search, 0, 80, 'search field');
    await results.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expectWithin(layer.getByRole('button', { name: '+ Add your own exercise' }), 0, PHONE.height - 234, 'last control, above the keyboard');
  });

  test('searching changes nothing on the page, and keeps "Or pick an exercise"', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    // A routine, so the quick-start block sits above the field -- the block whose hiding once
    // moved the field on the first letter typed (2026-11-08).
    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: 'New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await addExerciseToRoutine(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Save routine' }).click();
    await page.getByRole('link', { name: 'Log' }).click();
    await expect(page.getByText('Or pick an exercise', { exact: true })).toBeVisible();

    await page.setViewportSize(KEYBOARD_UP);
    await page.evaluate(() => window.scrollTo(0, 0));
    const search = page.getByPlaceholder('Search all exercises');
    await search.click();
    await expect(page.getByRole('dialog', { name: 'Exercise search' })).toBeVisible();
    const pinnedTop = Math.round((await box(search)).y);

    await startSampling(page);
    await search.pressSequentially('b');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();
    await search.pressSequentially('qzx');
    await expect(page.getByText(/No exercises match/)).toBeVisible();
    await page.waitForTimeout(400);
    const samples = await stopSampling(page);

    expect(samples.length, 'the sampler must have run').toBeGreaterThan(3);
    for (const { scrollY, top } of samples) {
      expect(top, `the field moved, to ${top} from ${pinnedTop}`).toBe(pinnedTop);
      expect(scrollY, 'the page scrolled').toBe(0);
    }
    await expect(page.getByText('Or pick an exercise', { exact: true })).toBeAttached();
    await expect(page.getByText('Start a routine', { exact: true })).toBeAttached();
  });
});

// A finger, not a mouse. On a phone the layer must be up BEFORE the field takes focus: focused at
// its place mid-page, Safari starts panning toward it and the layer then rides that pan (the
// 2026-11-26 flicker). So a tap opens the layer, then focuses the field where it now is, and the
// browser's own focus and click are cancelled -- including the click that would otherwise land on
// whatever the layer now puts under the finger.
test.describe('the search, by touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test('a tap opens the layer and focuses the field at the top, with nothing clicked under the finger', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    const search = page.getByPlaceholder('Search all exercises');
    await page.evaluate(() => window.scrollTo(0, 0));
    // Record the order: was the layer already up when the field took focus?
    await search.evaluate((input) => {
      const w = window as unknown as { __layerAtFocus: boolean | null };
      w.__layerAtFocus = null;
      input.addEventListener('focus', () => {
        w.__layerAtFocus = !!input.closest('.exercise-search-layer');
      });
    });

    await search.tap();

    const layer = page.getByRole('dialog', { name: 'Exercise search' });
    await expect(layer).toBeVisible();
    await expect(search).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { __layerAtFocus: boolean | null }).__layerAtFocus)).toBe(true);
    expect(Math.round((await box(search)).y), 'the field is pinned at the top of the screen').toBeLessThanOrEqual(24);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Typing works in the field the tap focused.
    await page.keyboard.type('press');
    await expect(search).toHaveValue('press');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();
  });
});

// Real finger DRAGS (CDP touch events, Chromium only), because the touch guard only ever sees
// touchmove -- a mouse wheel goes straight past it. 2026-11-26 on lower: "+ Add your own exercise"
// from the search opens its dialog over the still-open search layer, and the first guard (drags
// allowed only in the results) cancelled every drag inside that dialog, on the web and in the app.
test.describe('the search, by finger drag', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: KEYBOARD_UP });

  async function drag(page: Page, at: { x: number; y: number }, dy: number) {
    const cdp = await page.context().newCDPSession(page);
    const point = (y: number) => [{ x: Math.round(at.x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(at.y) });
    for (let i = 1; i <= 10; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(at.y - (dy * i) / 10) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  test('a drag scrolls the results, and scrolls the Add exercise dialog opened from them', async ({ page, request, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch drags are sent through CDP');
    await twoPersonHousehold(page, request);
    await page.getByPlaceholder('Search all exercises').tap();
    const layer = page.getByRole('dialog', { name: 'Exercise search' });
    await expect(layer).toBeVisible();
    await page.keyboard.type('press');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();

    const results = layer.locator('.exercise-search-results');
    const r = await box(results);
    // Playwright's tap() scrolls the field into view before tapping (it starts below the fold at
    // this height), so the page's own position is read here, not assumed to be 0.
    const pageBefore = await page.evaluate(() => window.scrollY);
    await drag(page, { x: r.x + r.width / 2, y: r.y + r.height - 20 }, 200);
    await expect.poll(() => results.evaluate((el) => el.scrollTop), 'a drag on the results scrolls them').toBeGreaterThan(0);
    // A drag on the search bar has nothing to scroll and must not move the page behind.
    const bar = await box(page.getByRole('button', { name: 'Cancel' }));
    await drag(page, { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 }, -150);
    expect(await page.evaluate(() => window.scrollY), 'the page behind never moves').toBe(pageBefore);

    await layer.getByRole('button', { name: '+ Add your own exercise' }).tap();
    const panel = page.locator('[data-modal-panel]').last();
    await dialogSettled(panel);
    const overflow = await panel.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, 'the dialog is taller than the space above the keyboard').toBeGreaterThan(0);
    const p = await box(panel);
    await drag(page, { x: p.x + p.width / 2, y: p.y + p.height - 30 }, 200);
    await expect.poll(() => panel.evaluate((el) => el.scrollTop), 'a drag inside the dialog scrolls it').toBeGreaterThan(0);
  });
});
