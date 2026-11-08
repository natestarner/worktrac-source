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

  test('the focused search field lands below the sticky chrome, not under it', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    await page.setViewportSize(KEYBOARD_UP);
    // A full page, so the field can actually be scrolled to the top.
    const search = page.getByPlaceholder('Search all exercises');
    await search.fill('press');
    await search.blur();
    // Re-issued on every poll: fill()'s own focus started a smooth scroll that can overtake a
    // one-shot scrollTo (sticky-chrome.spec.ts hit the same thing).
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.scrollTo(0, 0);
          return window.scrollY;
        }),
      )
      .toBe(0);

    // A tap, as on the phone.
    await search.click();
    const chrome = page.locator('.app-chrome');
    // The focus scroll is smooth, so poll until it lands: just BELOW the chrome's bottom edge.
    // Under it (a negative gap) is the bug; the old 132px clearance left -9px here.
    const gap = async () => {
      const c = await box(chrome);
      return Math.round((await box(search)).y - (c.y + c.height));
    };
    await expect
      .poll(async () => {
        const g = await gap();
        return g >= 4 && g <= 30 ? 'just below the chrome' : `gap ${g}px`;
      })
      .toBe('just below the chrome');
  });

  test('typing the first letter moves nothing, and keeps "Or pick an exercise"', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    // A routine, so the quick-start block sits above the field -- the block whose hiding caused it.
    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: 'New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await addExerciseToRoutine(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Save routine' }).click();
    await page.getByRole('link', { name: 'Log' }).click();
    await expect(page.getByText('Or pick an exercise', { exact: true })).toBeVisible();

    await page.setViewportSize(KEYBOARD_UP);
    const search = page.getByPlaceholder('Search all exercises');
    await search.click();
    // Let the focus scroll finish: the field holds still for 300ms. Two reads a frame apart was not
    // enough on a loaded machine -- a smooth scroll's last few pixels landed after the baseline.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const field = document.querySelector('.exercise-search-input')!;
          const a = field.getBoundingClientRect().top;
          await new Promise((r) => setTimeout(r, 300));
          return Math.abs(field.getBoundingClientRect().top - a) < 0.5;
        }),
      )
      .toBe(true);

    // Sample the field (and the chrome's bottom edge) on every frame while the first letter, then a
    // no-match search, are typed. A retrying matcher would wait out a jump and back; samples cannot.
    await page.evaluate(() => {
      const field = document.querySelector('.exercise-search-input')!;
      const chrome = document.querySelector('.app-chrome')!;
      const w = window as unknown as { __samples: { top: number; chromeBottom: number }[]; __sampling: boolean };
      w.__samples = [];
      w.__sampling = true;
      const sample = () => {
        w.__samples.push({
          top: Math.round(field.getBoundingClientRect().top),
          chromeBottom: Math.round(chrome.getBoundingClientRect().bottom),
        });
        if (w.__sampling) requestAnimationFrame(sample);
      };
      sample();
    });
    const before = Math.round((await box(search)).y);
    await search.pressSequentially('b');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();
    await search.pressSequentially('qzx');
    await expect(page.getByText(/No exercises match/)).toBeVisible();
    await page.waitForTimeout(400); // a few more frames, for any scroll the typing set off
    const samples = await page.evaluate(() => {
      const w = window as unknown as { __samples: { top: number; chromeBottom: number }[]; __sampling: boolean };
      w.__sampling = false;
      return w.__samples;
    });

    // What the bug did, measured red against the old code: the field shot UP under the tab bar
    // (176 -> 50, the routine block above it vanishing), then was scrolled back. So on every frame
    // the field must stay clear of the chrome, and must never be pushed DOWN the screen (a page
    // that shrank under it). A small move up IS allowed: when the setup's short page could not
    // scroll the field all the way to its landing spot, the first letter makes the page long and
    // the browser's own keep-the-caret-in-view settles it 15-20px closer to that spot.
    expect(samples.length, 'the sampler must have run').toBeGreaterThan(3);
    for (const { top, chromeBottom } of samples) {
      expect(top, `field went under the tab bar (top ${top}, chrome ends ${chromeBottom})`).toBeGreaterThanOrEqual(chromeBottom);
      expect(top, `field was pushed down the screen, to ${top} from ${before}`).toBeLessThanOrEqual(before + 1);
    }
    await expect(page.getByText('Or pick an exercise', { exact: true })).toBeAttached();
    await expect(page.getByText('Start a routine', { exact: true })).toBeAttached();
  });
});
