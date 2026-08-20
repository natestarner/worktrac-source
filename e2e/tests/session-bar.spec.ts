import { test, expect, Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addExerciseToRoutine, pickExercise } from './support/exercises';

// The load-bearing half of moving the session banner into fixed bottom chrome: the bar must never
// cover the end of a tab.
//
// This is a PIXEL claim, so only this layer can make it -- jsdom computes no layout, and
// SessionBar.test.jsx can only prove the reserved-space custom property gets SET, not that the
// value is big enough. The failure mode being guarded is pointer interception, which #176 produced
// at the top of the screen and which surfaced as seven unrelated specs failing on
// "person-pill-bar ... intercepts pointer events" rather than as anything naming the cause.
//
// `.app-shell`'s padding-bottom is what buys the clearance: it grows by --bottom-bar-height while
// the bar is mounted. Growing it moves nothing on screen (padding-bottom only extends the scroll
// range), which is why this placement has no tap-jump where the old in-flow top banner did.
//
// ⚠️ THE PAGE MUST BE LONG ENOUGH TO SCROLL, or every assertion here passes vacuously. A first cut
// of this spec asserted on "Log set" from the exercise screen and passed with the reserved padding
// deleted -- that button sits MID-page (the session's set list renders below it), so scrolling to
// the bottom moves it off the TOP rather than under the bar. Verified by mutation: with the
// --bottom-bar-height term removed from both .app-shell rules, the assertions below fail and the
// old ones did not.

// ⚠️ NOT asserted here, deliberately: that "Log set" specifically is never under the bar. A fixed
// bottom bar necessarily overlaps MID-document content at some scroll position -- that is true of
// any such bar, and "Log set" sits mid-page on the exercise screen (the session's set list renders
// below it). What the reserved padding actually guarantees is what the tests below measure: the END
// of the document clears the bar, so nothing is ever unreachable. An earlier draft asserted the
// stronger claim by force-scrolling the button flush to the viewport bottom, and it failed against
// CORRECT code -- it was measuring a scroll position no amount of reserved padding could satisfy.
// That "Log set" stays clickable with a session live is covered many times over by every other spec
// in this suite that logs a second set, each of which is an actionability-checked click.

const sessionBar = (page: Page) => page.locator('.session-bar');
const tabPanel = (page: Page) => page.locator('.tab-panel');
const logSet = (page: Page) => page.getByRole('button', { name: 'Log set' });

// A newly-registered person's Log tab is a nearly-empty picker with nothing to scroll. Searching
// the seeded catalog fills the page with real content in normal flow -- the same technique
// sticky-chrome.spec.ts uses for the opposite edge of the screen.
async function fillPageWithCatalogResults(page: Page) {
  await page.getByPlaceholder('Search all exercises').fill('press');
  await expect
    .poll(() => page.evaluate(() => document.body.scrollHeight - window.innerHeight))
    .toBeGreaterThan(200);
}

async function scrollToBottom(page: Page) {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        return page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.body.scrollHeight - 2);
      },
      { timeout: 5000 },
    )
    .toBe(true);
}

// The direct measurement of the reservation. `.tab-panel` holds every tab's content; `.app-shell`'s
// padding-bottom sits OUTSIDE it, so with the bar's height reserved the panel's bottom edge clears
// the bar's top edge once the page is scrolled all the way down. Without it the panel runs on
// underneath the bar and the last thing on the page is unreachable.
async function expectTabContentClearsBar(page: Page) {
  const panel = await tabPanel(page).boundingBox();
  const bar = await sessionBar(page).boundingBox();
  expect(panel, 'tab panel should be on screen').not.toBeNull();
  expect(bar, 'session bar should be on screen').not.toBeNull();
  expect(
    Math.round(panel!.y + panel!.height),
    `tab content (bottom ${panel!.y + panel!.height}) must clear the session bar (top ${bar!.y})`,
  ).toBeLessThanOrEqual(Math.round(bar!.y));
}

async function startASession(page: Page, request: Parameters<typeof registerHousehold>[1], name: string) {
  await registerHousehold(page, request, name);
  await pickExercise(page, 'Barbell Bench Press');
  await logSet(page).click();
  await expect(page.getByText('New PR!')).toBeVisible();
  await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)
  await expect(sessionBar(page)).toBeVisible();
}

test.describe('Session bar never covers the end of a tab', () => {
  test.describe('portrait phone', () => {
    test.use({ viewport: { width: 390, height: 664 } });

    test('leaves the end of a full-length tab above the bar', async ({ page, request }) => {
      await startASession(page, request, 'Portrait');

      await page.getByRole('button', { name: '← All exercises' }).click();
      await fillPageWithCatalogResults(page);
      await scrollToBottom(page);

      await expectTabContentClearsBar(page);

      // And the last row is genuinely reachable, not merely un-overlapped by a rounding margin.
      await page.getByRole('button', { name: /press/i }).last().click();
      await expect(logSet(page)).toBeVisible();
    });
  });

  // Landscape on a phone is the tightest case -- it is why .app-shell's own bottom padding drops
  // from --space-10 to --space-4 there, and why the bar itself is 8px shorter.
  test.describe('landscape phone', () => {
    test.use({ viewport: { width: 740, height: 380 } });

    test('leaves the end of a full-length tab above the bar in landscape too', async ({ page, request }) => {
      await startASession(page, request, 'Landscape');

      await page.getByRole('button', { name: '← All exercises' }).click();
      await fillPageWithCatalogResults(page);
      await scrollToBottom(page);

      await expectTabContentClearsBar(page);
    });
  });
});

test.describe('Session bar stacking', () => {
  test.use({ viewport: { width: 390, height: 664 } });

  // The toast sat at the same coordinates as the floating rest timer this bar replaces, and blanked
  // its countdown for the toast's full 3.2s. z-index does not fix that -- the toast is z-40 against
  // the bar's z-20, so it was always going to win the paint. The fix is positional: the toast's
  // `bottom` clears --bottom-bar-height. "End routine" is used to raise it because it is the one
  // toast that leaves the session (and therefore the bar) standing.
  test('a toast sits above the bar rather than on top of it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Toasty');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await addExerciseToRoutine(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Save routine' }).click();
    await page.getByRole('button', { name: 'Start routine' }).click();

    await logSet(page).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true });
    await expect(sessionBar(page)).toBeVisible();

    await page.getByRole('button', { name: 'End routine' }).click();

    const toast = page.getByText('Routine ended.');
    await expect(toast).toBeVisible();
    // The session is still live, so both are on screen at once -- the only state in which this can
    // be measured at all.
    await expect(sessionBar(page)).toBeVisible();

    const toastBox = await toast.boundingBox();
    const barBox = await sessionBar(page).boundingBox();
    expect(
      Math.round(toastBox!.y + toastBox!.height),
      `toast (bottom ${toastBox!.y + toastBox!.height}) must clear the session bar (top ${barBox!.y})`,
    ).toBeLessThanOrEqual(Math.round(barBox!.y));
  });
});
