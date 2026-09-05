import { test, expect, Page, Locator } from '@playwright/test';
import { registerHousehold } from './support/auth';

// What survives a scroll at the top of the screen, and what doesn't.
//
// The rule (AppShell.jsx owns it): the tab bar always sticks; the person bar sticks only for a
// household of two or more, where it is a switcher rather than a label; the Huddle lockup never
// sticks. All three used to travel together, which spent 218px portrait / 178px landscape on
// permanent chrome -- on a phone held sideways mid-set, close to half the viewport.
//
// AppShell.test.jsx asserts the STRUCTURE (which bar is inside the sticky box). jsdom computes no
// layout, so only this file can tell you the structure actually produces the behaviour.

// A phone-sized viewport, both because that is where the vertical budget actually matters and
// because it is the tightest case for fitting the chrome plus content.
test.use({ viewport: { width: 390, height: 664 } });

const logo = (page: Page) => page.locator('img[alt="Huddle"]');
const personBar = (page: Page) => page.locator('.person-pill-bar');
const tabs = (page: Page) => page.locator('.tabs-nav-bar');

// A newly-registered person's Log tab is a nearly-empty picker -- roughly half a screen, with
// nothing to scroll, which would make every assertion below pass vacuously. Searching the seeded
// catalog fills the page with real app content (the picker renders results in normal flow, with
// no inner scroller of its own). Must be re-run per person: the search term is per-person state,
// so a newly-added person starts back at the empty picker.
async function fillPageWithCatalogResults(page: Page) {
  await page.getByPlaceholder('Search all exercises').fill('press');
  await expect
    .poll(() => page.evaluate(() => document.body.scrollHeight - window.innerHeight))
    .toBeGreaterThan(200);
}

// Re-issues the scroll on every poll rather than checking once: focusing the picker's search box
// kicks off a smooth `scrollIntoView` (see ExercisePicker.jsx), and a one-shot scrollTo can be
// overtaken by it mid-animation.
async function scrollToBottom(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          return window.scrollY;
        }),
      { message: 'page must actually scroll or these assertions prove nothing' },
    )
    .toBeGreaterThan(100);
  // sticky offsets settle on the next frame, not synchronously with scrollTo
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
}

// Playwright reports bounding boxes in viewport coordinates, so "stuck to the top" is y ~= 0 and
// "scrolled away" is a box entirely above the fold. The 2px tolerance absorbs the chrome's
// sub-pixel hairline.
async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, 'element has no layout box').not.toBeNull();
  return box!.y;
}

async function assertScrolledOffTop(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  // A `position: static` element that has scrolled past the top still HAS a box -- it just sits
  // at a negative y. Playwright returns null only if it is not rendered at all.
  expect(box, `${label} should still be in the document, just off-screen`).not.toBeNull();
  expect(box!.y + box!.height, `${label} should have scrolled off the top`).toBeLessThanOrEqual(0);
}

async function addPerson(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(personBar(page).getByRole('button', { name: new RegExp(name) })).toBeVisible();
}

test.describe('Sticky chrome by household size', () => {
  test('one person: the tab bar sticks, the logo and the person bar scroll away', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');
    await fillPageWithCatalogResults(page);

    await scrollToBottom(page);

    await assertScrolledOffTop(logo(page), 'the Huddle lockup');
    await assertScrolledOffTop(personBar(page), 'the person bar');
    // Nothing sticky above it, so the tab bar sits flush against the top of the viewport.
    expect(await topOf(tabs(page))).toBeLessThanOrEqual(2);
  });

  test('two people: the person bar sticks above the tab bar, and only the logo scrolls away', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'Alex');
    await addPerson(page, 'Sam');
    await fillPageWithCatalogResults(page);

    await scrollToBottom(page);

    await assertScrolledOffTop(logo(page), 'the Huddle lockup');

    // The person bar takes the top slot, and the tab bar stacks directly beneath it with no gap
    // and no overlap -- which is the whole reason the two stay in one sticky box.
    const personBox = (await personBar(page).boundingBox())!;
    expect(personBox.y).toBeLessThanOrEqual(2);
    expect(await topOf(tabs(page))).toBeCloseTo(personBox.y + personBox.height, 0);
  });

  // The account menu hangs out of the header and down across the sticky chrome. With the header
  // inside that chrome it shared its stacking context and this was free; outside it, the chrome
  // is a sibling that paints later, so at an equal z-index it covered the menu and swallowed
  // every click. Nothing asserted it directly -- it surfaced as seven unrelated specs failing on
  // "person-pill-bar ... intercepts pointer events", which is a slow way to find out.
  test('the account menu opens over the sticky chrome and stays clickable', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');
    // Two people, so the person bar is the thing sitting directly under the menu.
    await addPerson(page, 'Sam');

    await page.locator('.header-bar').getByRole('button').click();
    const profile = page.getByRole('menuitem', { name: 'Profile' });
    await expect(profile).toBeVisible();

    // The click, not just visibility: an intercepted menu item is fully visible: it is the
    // pointer-events hit test that lands on the chrome instead.
    await profile.click({ timeout: 5000 });
    await expect(page).toHaveURL(/\/app\/profile/);
  });

  // The transition itself: the person bar has to change which box it lives in, and it must not
  // leave the household looking at a switcher that scrolls away the moment they need it.
  test('adding a second person promotes the person bar to sticky without a reload', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alex');
    await fillPageWithCatalogResults(page);
    await scrollToBottom(page);
    await assertScrolledOffTop(personBar(page), 'the person bar while solo');

    await page.evaluate(() => window.scrollTo(0, 0));
    await addPerson(page, 'Sam');
    await fillPageWithCatalogResults(page);

    await scrollToBottom(page);

    expect(await topOf(personBar(page))).toBeLessThanOrEqual(2);
  });
});

// The tab bar's own describe block, separate from this file's 390px default: these tests need to
// sweep a RANGE of widths, from a narrow phone up through desktop, rather than assert at one.
test.describe('Tab bar: full padding when there is room, a CSS lock when there is not', () => {
  // Only a real browser can prove any of this: jsdom lays nothing out.

  // Regression for three bugs now, each found fixing the last one:
  //   1. Original: `.seg` at its full intrinsic padding is wider than a phone -- reaching the
  //      last tab needed a swipe with no visible scrollbar to suggest one was possible.
  //   2. Introduced fixing #1, then reverted: switching to `.seg-fill` DID stop the overflow, but
  //      it also stretches the row to the container's full width on every screen -- correct on a
  //      phone, wrong on a tablet/desktop where `.seg` living at its own content width (not
  //      filling the row) is the look this bar has always had.
  //   3. Introduced fixing #2, caught on lower rather than here: a padding lock fitted from pixel
  //      constants measured on ONE font (this repo's dev machines, which -- like every non-Apple
  //      platform -- fall through this app's `-apple-system` stack to a substitute) still
  //      overflowed by ~40px against lower e2e's Linux/Chromium fallback, a THIRD font again.
  // #1 and #2 are what this file can actually reproduce (this machine's own font never triggers
  // #3). What it CAN assert about #3 is the guarantee `.tabs-nav-bar .seg`'s `max-width: 100%`
  // plus its item rule's `flex-shrink`/ellipsis pair make true regardless of which font renders:
  // never wider than the row, never stretched to fill it.
  for (const width of [320, 375, 390, 414, 768, 1280]) {
    test(`fits without scrolling and without stretching full-width at ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 700 });
      await registerHousehold(page, request, 'Alex');

      // No scrolling needed to reach any of them (bug #1) -- a structural guarantee now
      // (`max-width: 100%` on `.seg`), not just a measurement that happened to hold on the fonts
      // this could be tested against. Deliberately NOT also asserting each tab's own label never
      // overflows its box: under a wider-than-measured font that IS how the guarantee holds --
      // ellipsis, not the overlap `.seg-fill`'s own item rule guards against -- so some per-label
      // overflow here is the safety net working, not a regression.
      const navOverflow = await page
        .locator('.tabs-nav-bar')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(navOverflow, `the tab bar needs ${navOverflow}px of horizontal scroll to reach every tab`).toBeLessThanOrEqual(1);

      // And it never grows wider than its own container (bug #2), checked at the widest end of
      // the sweep where "shrink to fit" and "stretch to fill" look identical at narrow widths but
      // diverge sharply once there's room to spare.
      if (width >= 768) {
        const barWidth = (await page.locator('.tabs-nav-bar').boundingBox())!.width;
        const segWidth = (await page.locator('.tabs-nav-bar .seg').boundingBox())!.width;
        expect(segWidth, 'the tab bar stretched to fill its full-width container instead of hugging its own content').toBeLessThan(barWidth * 0.6);
      }
    });
  }

  // The specific ask this was built for: on a phone narrow enough to need the lock at all, the
  // shrunk row's right edge should never run PAST the same content column beside it (the search
  // box) -- a structural guarantee from `.seg`'s own `max-width: 100%`, true on any font. How
  // close it lands short of that edge is font-metric-dependent (bug #3 above) and deliberately
  // NOT asserted here -- verified instead against real renders in the fix's own commit message.
  test('on a narrow phone, the shrunk row never runs past the content column beside it', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await registerHousehold(page, request, 'Alex');

    const segRight = (await page.locator('.tabs-nav-bar .seg').boundingBox())!;
    const searchRight = (await page.getByPlaceholder('Search all exercises').boundingBox())!;
    const gap = searchRight.x + searchRight.width - (segRight.x + segRight.width);

    expect(gap, `the tab bar's right edge is ${-gap}px PAST the content column's`).toBeGreaterThanOrEqual(-1);
  });

  // Bug #3 above, reproduced directly rather than hoped for: this machine's own fallback font
  // never triggers it, and lower's Linux/Chromium fallback isn't available to test against here,
  // so the only way to actually exercise "a font wider than whatever this was measured on" is to
  // force one. A generic serif plus extra letter-spacing stands in for "some font this was never
  // measured against" -- the point isn't THIS specific font, it's that the guarantee holds for a
  // font unlike either one actually measured (see index.css's comment on .tabs-nav-bar .seg-item).
  test('still fits without scrolling under a font much wider than any this was tuned against', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await registerHousehold(page, request, 'Alex');

    await page.addStyleTag({
      content: '.tabs-nav-bar .seg-item { font-family: "Times New Roman", serif !important; letter-spacing: 1.5px !important; }',
    });

    const navOverflow = await page
      .locator('.tabs-nav-bar')
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(navOverflow, `the tab bar needs ${navOverflow}px of horizontal scroll under a wider font`).toBeLessThanOrEqual(1);
  });
});
