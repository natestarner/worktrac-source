import { test, expect, Page, Locator } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addPerson } from './support/people';
import { addExerciseToRoutine, logSetButton, searchField, searchFor, searchScreen, searchTrigger } from './support/exercises';

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
// defeated about half the time (#626); a full-screen layer replaced that and broke differently
// (2026-11-26). The search is now its own screen, opened by a tap that focuses its field at the
// top: nothing moves while the keyboard opens. docs/architecture/exercise-search-history.md.
//
// No browser here opens a software keyboard. Two shapes stand in for it:
//   - The App Store app's: the window itself shrinks above the keyboard (`Keyboard.resize:
//     "native"`), i.e. a short viewport. Driven with setViewportSize.
//   - Safari's: the window stays full height and only the VISUAL viewport shrinks and pans. A
//     Chromium page can't fake visualViewport, so the dialog spec publishes the two values the app
//     derives from it (`--visible-viewport-top` / `-height`) itself, onto the dialog's scrim where
//     the app puts them; that the app publishes them from visualViewport is pinned by
//     visibleViewport.test.js.

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

    // The app publishes the visible part onto the open dialog's scrim, never the page's root:
    // custom properties inherit, and on the root every keyboard frame restyled the whole page.
    const published = await dialog.evaluate((el) => ({
      scrim: (el.parentElement as HTMLElement).style.getPropertyValue('--visible-viewport-height'),
      root: document.documentElement.style.getPropertyValue('--visible-viewport-height'),
    }));
    expect(published.scrim, 'published onto the scrim').not.toBe('');
    expect(published.root, 'never onto the root').toBe('');

    // Safari with the keyboard up: the visible part is 250..610 of a full-height page.
    await dialog.evaluate((el) => {
      const scrim = (el.parentElement as HTMLElement).style;
      scrim.setProperty('--visible-viewport-top', '250px');
      scrim.setProperty('--visible-viewport-height', '360px');
    });
    await expectWithin(dialog, 250, 610, 'add exercise dialog');
    await expectWithin(dialog.getByRole('button', { name: 'Close' }), 250, 610, 'close button');
    await expectWithin(dialog.getByRole('textbox').first(), 250, 610, 'name field');
  });
});

// Records window.scrollY and the search field's top on every frame until stopped. A retrying
// matcher would wait out a field that moved and came back; samples cannot.
async function startSampling(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __samples: { scrollY: number; top: number }[]; __sampling: boolean };
    w.__samples = [];
    w.__sampling = true;
    const sample = () => {
      const field = document.querySelector('[aria-label="Exercise search"] input');
      if (field) w.__samples.push({ scrollY: Math.round(window.scrollY), top: Math.round(field.getBoundingClientRect().top) });
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

// The Log tab's exercise search is its own SCREEN (ExerciseSearchScreen): the Log page's search
// "field" is a button, and a tap opens an ordinary page with the field at the top, focused in the
// same click, and the results below it in normal document flow. Nothing moves while the keyboard
// opens, which is what every earlier design (scroll the page to the field; a fixed layer) got wrong
// on iPhones. docs/architecture/exercise-search-history.md.
test.describe('the exercise search screen', () => {
  test('a tap opens it: the field focused at the top, the chrome gone, and the field never moves', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    // The tap lands on a full-height phone; the keyboard (the app's window shrinking) comes after.
    await page.setViewportSize(PHONE);
    await searchTrigger(page).click();

    const screen = searchScreen(page);
    await expect(screen).toBeVisible();
    await expect(searchField(page)).toBeFocused();
    // The chrome is hidden, so the search bar is the top of the page.
    await expect(page.locator('.app-chrome')).toBeHidden();
    await expect(page.locator('.header-bar')).toBeHidden();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const top = Math.round((await box(searchField(page))).y);
    expect(top, 'the field is at the top of the screen').toBeLessThanOrEqual(40);

    // The keyboard arrives, and results draw under the field as it is typed into. Not one frame
    // may move the field.
    await startSampling(page);
    await page.setViewportSize(KEYBOARD_UP);
    await searchField(page).pressSequentially('press');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();
    await page.waitForTimeout(400); // a few more frames, for anything the typing set off
    const samples = await stopSampling(page);
    expect(samples.length, 'the sampler must have run').toBeGreaterThan(3);
    for (const s of samples) {
      expect(s.top, 'the field moved').toBe(top);
      expect(s.scrollY, 'the page scrolled').toBe(0);
    }
  });

  test('the results scroll with the page, under a field that stays put, and end at "+ Add your own exercise"', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    await page.setViewportSize(KEYBOARD_UP);
    await searchFor(page, 'press');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();
    const top = Math.round((await box(searchField(page))).y);

    // Ordinary page scrolling: there is more than fits, and the end can be reached.
    const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(room, 'the results run past the screen').toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const add = searchScreen(page).getByRole('button', { name: '+ Add your own exercise' });
    await expectWithin(add, 0, KEYBOARD_UP.height, 'the last control, scrolled to');
    // The field stuck to the top through the scroll.
    expect(Math.round((await box(searchField(page))).y), 'the field scrolled away').toBe(top);
    // And nothing to scroll into past it: the SessionBar's reserved space goes with the bar
    // (Brave scrolled well past the end in the layer this replaced).
    const below = await add.evaluate((el) => document.documentElement.scrollHeight - (el.getBoundingClientRect().bottom + window.scrollY));
    expect(below, 'blank space under the last control').toBeLessThan(80);
  });

  test('with nothing typed it lists the whole library A-Z; typing narrows it, clearing brings it back', async ({ page, request }) => {
    await registerHousehold(page, request, 'Browse');
    // The list is drawn AFTER the tap: the field is focused inside the tap's click handler, so
    // anything drawn on mount delays the keyboard (~200 rows held the tap 0.65-1.4s on a phone-speed
    // CPU). So at the instant the field takes the focus, no result row may exist yet.
    await page.evaluate(() => {
      document.addEventListener(
        'focusin',
        (e) => {
          // The field, not the Log page's trigger button of the same name.
          const el = e.target as HTMLElement;
          if (el.tagName !== 'INPUT' || el.getAttribute('aria-label') !== 'Search all exercises') return;
          (window as any).__rowsAtFocus ??= document.querySelectorAll('section button[id][aria-label]').length;
        },
        true,
      );
    });
    await searchTrigger(page).click();
    const screen = searchScreen(page);
    await expect(screen.getByText('All exercises', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__rowsAtFocus), 'rows drawn inside the tap').toBe(0);
    // Each result row is the button carrying the exercise's id (ExerciseSearchResults).
    const rowNames = () => screen.locator('button[id][aria-label]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    const all = await rowNames();
    expect(all.length, 'the library, not a handful').toBeGreaterThan(100);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
    expect(all).toContain('Barbell Bench Press');

    await searchField(page).fill('bench');
    await expect(screen.getByText('Search results', { exact: true })).toBeVisible();
    const matches = await rowNames();
    expect(matches.length).toBeLessThan(all.length);
    for (const name of matches) expect(all).toContain(name);

    await searchField(page).fill('');
    await expect(screen.getByText('All exercises', { exact: true })).toBeVisible();
    expect(await rowNames()).toEqual(all);
    // Chosen straight from the list, like any result.
    await screen.getByRole('button', { name: 'Barbell Bench Press', exact: true }).click();
    await expect(screen).toBeHidden();
    await expect(logSetButton(page)).toBeVisible();
  });

  test('Cancel goes back to the Log page where it was, and the typed search goes with it', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    await page.setViewportSize(KEYBOARD_UP);
    // The field mid-page: scroll so it sits a little way down the screen.
    await searchTrigger(page).scrollIntoViewIfNeeded();
    const scrolledTo = await page.evaluate(() => window.scrollY);
    const triggerTop = Math.round((await box(searchTrigger(page))).y);

    await searchFor(page, 'bench');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(searchScreen(page)).toHaveCount(0);
    await expect(page.locator('.app-chrome')).toBeVisible();
    await expect(searchTrigger(page)).toHaveText('Search all exercises');
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolledTo);
    expect(Math.round((await box(searchTrigger(page))).y)).toBe(triggerTop);
    // Cancel means "never mind": the next search starts empty.
    await searchTrigger(page).click();
    await expect(searchField(page)).toHaveValue('');
  });

  // Back pressed the moment the URL changes, before React Router has rendered the search route (a
  // transition): the route never "leaves" anything, so only popstate can close it. Red in WebKit
  // before the popstate listener (2026-11-26).
  test("the browser's Back closes it too, however soon it is pressed", async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    await searchTrigger(page).click();
    await expect(page).toHaveURL(/\/app\/log\/search$/);
    await page.goBack();
    await expect(searchScreen(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/log$/);
    await expect(searchTrigger(page)).toBeVisible();
  });

  // Only a tap can raise the keyboard, so the screen never opens by itself.
  test('a reload on it lands on the Log page', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    await searchFor(page, 'bench');
    await page.reload();
    await expect(page).toHaveURL(/\/app\/log$/);
    await expect(searchScreen(page)).toHaveCount(0);
    await expect(searchTrigger(page)).toHaveText('Search all exercises');
  });

  test('choosing a result opens it, and Back from it does not reopen the search', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    await searchFor(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Barbell Bench Press', exact: true }).click();
    await expect(logSetButton(page)).toBeVisible();
    await expect(searchScreen(page)).toHaveCount(0);
    await expect(page.locator('.app-chrome')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/log$/);
  });

  test('searching changes nothing on the Log page, and keeps "Or pick an exercise"', async ({ page, request }) => {
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

    await searchFor(page, 'qzx');
    await expect(page.getByText(/No exercises match/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(page.getByText('Or pick an exercise', { exact: true })).toBeVisible();
    await expect(page.getByText('Start a routine', { exact: true })).toBeVisible();
    // "Or pick an exercise" still heads the search field: the page order never changes.
    const heading = await box(page.getByText('Or pick an exercise', { exact: true }));
    expect((await box(searchTrigger(page))).y).toBeGreaterThan(heading.y);
  });
});

// A finger, not a mouse: Chromium's touch tap ends in the same click a person's does, and the click
// handler is what focuses the field (the one place iOS raises the keyboard for a programmatic
// focus). The layer this replaced opened on touchend, and WebKit's ghost click then took the focus
// back off the field (TestFlight 1.5.0, run 40).
test.describe('the exercise search screen, by touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test('a tap opens it with the field focused, and typing goes into it', async ({ page, request }) => {
    await twoPersonHousehold(page, request);
    await searchTrigger(page).tap();
    await expect(searchScreen(page)).toBeVisible();
    await expect(searchField(page)).toBeFocused();
    await page.keyboard.type('press');
    await expect(searchField(page)).toHaveValue('press');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();
  });
});

// Real finger DRAGS (CDP touch events, Chromium only): a mouse wheel never reaches touch handling.
// 2026-11-26: under the layer, "+ Add your own exercise" opened its dialog over the open search and
// a touch guard froze it. The screen has no guard, but the dialog opened from it must still scroll.
test.describe('the exercise search screen, by finger drag', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: KEYBOARD_UP });

  // A finger's drag: a frame between moves, and a pause before lifting, so it scrolls without
  // flinging. Ten moves with no time between them read as infinite speed, Chromium starts a fling
  // that outlasts any wait, and it then suppresses the next tap as a fling-stop -- measured
  // 2026-11-26: after such a drag a tap sent touchstart/touchend and no click at all.
  async function drag(page: Page, at: { x: number; y: number }, dy: number) {
    const cdp = await page.context().newCDPSession(page);
    const point = (y: number) => [{ x: Math.round(at.x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(at.y) });
    for (let i = 1; i <= 10; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(at.y - (dy * i) / 10) });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  test('a drag scrolls the results, and the Add exercise dialog opened from them', async ({ page, request, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch drags are sent through CDP');
    await twoPersonHousehold(page, request);
    await searchTrigger(page).tap();
    await page.keyboard.type('press');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();
    const top = Math.round((await box(searchField(page))).y);

    await drag(page, { x: 195, y: KEYBOARD_UP.height - 40 }, 200);
    await expect.poll(() => page.evaluate(() => window.scrollY), 'a drag on the results scrolls the page').toBeGreaterThan(0);
    expect(Math.round((await box(searchField(page))).y), 'the field stayed at the top').toBe(top);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await searchScreen(page).getByRole('button', { name: '+ Add your own exercise' }).tap();
    const panel = page.locator('[data-modal-panel]').last();
    await dialogSettled(panel);
    const overflow = await panel.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, 'the dialog is taller than the space above the keyboard').toBeGreaterThan(0);
    const p = await box(panel);
    await drag(page, { x: p.x + p.width / 2, y: p.y + p.height - 30 }, 200);
    await expect.poll(() => panel.evaluate((el) => el.scrollTop), 'a drag inside the dialog scrolls it').toBeGreaterThan(0);
  });
});
