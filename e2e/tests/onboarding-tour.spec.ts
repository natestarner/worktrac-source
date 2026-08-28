import { Page, test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// The first-run guided tour. Full design: the plan at
// C:\Users\natha\.claude\plans\when-a-user-logs-steady-giraffe.md (components/onboarding/).
//
// registerHousehold's own dismissal of the welcome modal is what every OTHER spec in this suite
// relies on -- this file is the one place that deliberately keeps it (`keepWelcome: true`) to
// exercise the modal and the tour it launches.

// Anchor selectors, pinned as literals rather than imported from the frontend source -- same
// reasoning as HelpTab.test.jsx pinning its own SECTION_IDS: a derived list would agree with any
// rename instead of catching it. Kept in one place here so a real drift shows up as EVERY test in
// this file failing at once, not one at a time.
const ANCHOR = {
  logTab: '[data-tour-anchor="log-tab"]',
  peopleBar: '[data-tour-anchor="people-bar"]',
  exerciseSearch: '[data-tour-anchor="exercise-search"]',
  addExercise: '[data-tour-anchor="add-exercise"]',
  setEntry: '[data-tour-anchor="set-entry"]',
  logSet: '[data-tour-anchor="log-set"]',
  customizeExercise: '[data-tour-anchor="customize-exercise"]',
  newRoutine: '[data-tour-anchor="new-routine"]',
  accountMenu: '[data-tour-anchor="account-menu"]',
};

// Title + anchor for each of the nine steps, in order.
const STEPS: Array<{ title: string; anchor: string }> = [
  { title: 'Everything starts on the Log tab', anchor: ANCHOR.logTab },
  { title: 'Everyone on one account', anchor: ANCHOR.peopleBar },
  { title: 'Search the whole library', anchor: ANCHOR.exerciseSearch },
  { title: 'Your gym\u2019s odd machine', anchor: ANCHOR.addExercise },
  { title: 'Weight and reps', anchor: ANCHOR.setEntry },
  { title: 'One button per set', anchor: ANCHOR.logSet },
  { title: 'Make it yours', anchor: ANCHOR.customizeExercise },
  { title: 'A saved running order', anchor: ANCHOR.newRoutine },
  { title: 'Settings and help live here', anchor: ANCHOR.accountMenu },
];

async function dismissWelcomeAndSearch(page: Page) {
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('dialog', { name: 'Welcome to Huddle' })).toBeHidden();
}

async function openHelp(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/app\/help/);
}

async function clickContinue(page: Page) {
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function expectStep(page: Page, index: number) {
  await expect(page.getByText(`Step ${index + 1} of 9`)).toBeVisible();
  await expect(page.getByText(STEPS[index].title, { exact: true })).toBeVisible();
}

// Containment, not equality -- the spotlight is the anchor inflated by SPOTLIGHT_PADDING, and an
// exact number here would pin that design choice instead of the contract ("the tour is pointing
// at the right control"). Polled because the spotlight's position transitions (--dur-slow) rather
// than snapping.
async function expectSpotlightContainsAnchor(page: Page, anchorSelector: string) {
  const anchor = page.locator(anchorSelector).first();
  await expect(anchor).toBeVisible();
  await expect
    .poll(async () => {
      const anchorBox = await anchor.boundingBox();
      const spotlightBox = await page.locator('.tour-spotlight').boundingBox();
      if (!anchorBox || !spotlightBox) return false;
      const slack = 1; // sub-pixel rounding
      return (
        spotlightBox.x <= anchorBox.x + slack &&
        spotlightBox.y <= anchorBox.y + slack &&
        spotlightBox.x + spotlightBox.width >= anchorBox.x + anchorBox.width - slack &&
        spotlightBox.y + spotlightBox.height >= anchorBox.y + anchorBox.height - slack
      );
    })
    .toBe(true);
}

test.describe('Welcome modal', () => {
  test('appears once on a fresh account, and Not now dismisses it for good', async ({ page, request }) => {
    await registerHousehold(page, request, 'Ellis', { keepWelcome: true });

    const modal = page.getByRole('dialog', { name: 'Welcome to Huddle' });
    await expect(modal).toBeVisible();
    await expect(page.getByText(/Help/)).toBeVisible(); // mentions it's replayable

    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(modal).toBeHidden();

    // Proves the flag was actually CLEARED, not merely that a component unmounted -- a reload
    // re-reads it fresh.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByRole('dialog', { name: 'Welcome to Huddle' })).toBeHidden();
  });
});

test.describe('The full walk at portrait phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Show me around walks all nine steps, genuinely arranging the app at each one', async ({ page, request }) => {
    await registerHousehold(page, request, 'Priya', { keepWelcome: true });
    await page.getByRole('button', { name: 'Show me around' }).click();

    await expectStep(page, 0);
    await expectSpotlightContainsAnchor(page, ANCHOR.logTab);

    await clickContinue(page);
    await expectStep(page, 1);
    await expectSpotlightContainsAnchor(page, ANCHOR.peopleBar);

    await clickContinue(page);
    await expectStep(page, 2);
    await expectSpotlightContainsAnchor(page, ANCHOR.exerciseSearch);

    await clickContinue(page);
    await expectStep(page, 3);
    await expectSpotlightContainsAnchor(page, ANCHOR.addExercise);

    await clickContinue(page);
    await expectStep(page, 4);
    // The app really moved: an exercise is now open behind the scrim.
    await expect(page.locator(ANCHOR.setEntry)).toBeVisible();
    await expectSpotlightContainsAnchor(page, ANCHOR.setEntry);

    await clickContinue(page);
    await expectStep(page, 5);
    await expect(page.locator(ANCHOR.logSet)).toBeVisible();
    await expectSpotlightContainsAnchor(page, ANCHOR.logSet);

    await clickContinue(page);
    await expectStep(page, 6);
    await expectSpotlightContainsAnchor(page, ANCHOR.customizeExercise);

    await clickContinue(page);
    await expectStep(page, 7);
    await expect(page).toHaveURL(/\/app\/routines/);
    await expectSpotlightContainsAnchor(page, ANCHOR.newRoutine);

    await clickContinue(page);
    await expectStep(page, 8);
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible(); // back on the picker
    await expectSpotlightContainsAnchor(page, ANCHOR.accountMenu);

    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  // A four-panel dimming implementation fails this: the "hole" over the anchor would be a
  // genuine gap in the click-blocking, and this click would land on the real Log-set button
  // underneath it.
  test('the overlay blocks the app -- clicking through the spotlight at step 6 logs nothing', async ({ page, request }) => {
    await registerHousehold(page, request, 'Marguerite', { keepWelcome: true });
    await page.getByRole('button', { name: 'Show me around' }).click();
    for (let i = 0; i < 5; i++) await clickContinue(page);
    await expectStep(page, 5);

    const box = await page.locator('.tour-spotlight').boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(page.getByText(/^Set \d+$/)).toHaveCount(0);
    await expectStep(page, 5); // the tour itself is unaffected -- still on the same step
  });
});

// The tightest, and the two wide layouts -- see the plan's layout section for why 1440x900 (a
// LAPTOP) lands in the same two-column middle row as a landscape phone, and why full-screen
// desktop is the one case the app's single breakpoint MISSES.
const GEOMETRY_VIEWPORTS = [
  { name: 'landscape phone', width: 844, height: 390 },
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'full-screen desktop', width: 1920, height: 1080 },
];

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

for (const viewport of GEOMETRY_VIEWPORTS) {
  test.describe(`Geometry at ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the card stays fully on screen and never overlaps the chrome or the session bar', async ({ page, request }) => {
      await registerHousehold(page, request, `Geo${viewport.width}`, { keepWelcome: true });
      await page.getByRole('button', { name: 'Show me around' }).click();

      for (let i = 0; i < STEPS.length; i++) {
        if (i > 0) await clickContinue(page);
        await expectStep(page, i);

        await expect
          .poll(async () => {
            const card = await page.getByRole('dialog').boundingBox();
            if (!card) return 'no card box';
            if (card.x < 0 || card.y < 0 || card.x + card.width > viewport.width || card.y + card.height > viewport.height) {
              return 'card off-screen';
            }
            const chrome = await page.locator('.app-chrome').boundingBox();
            if (chrome && boxesOverlap(card, chrome)) return 'overlaps chrome';
            const sessionBarCount = await page.locator('.session-bar').count();
            if (sessionBarCount > 0) {
              const sessionBar = await page.locator('.session-bar').boundingBox();
              if (sessionBar && boxesOverlap(card, sessionBar)) return 'overlaps session bar';
            }
            return 'ok';
          })
          .toBe('ok');
      }

      await page.getByRole('button', { name: 'Got it' }).click();
    });
  });
}

test.describe('Escape skips and restores', () => {
  // The exact risk the restore mechanism exists for: SELECT_EXERCISE clears exerciseSearch as a
  // side effect, and the tour's own step 5 calls it internally -- so without the restore, taking
  // the tour would silently wipe out a half-typed search.
  test('restores a half-typed search that the tour would otherwise clear', async ({ page, request }) => {
    await registerHousehold(page, request, 'Odalys', { keepWelcome: true });
    await dismissWelcomeAndSearch(page);

    await page.getByPlaceholder('Search all exercises').fill('dead');
    await openHelp(page);

    await page.getByRole('button', { name: 'Take the tour' }).click();
    await clickContinue(page);
    await clickContinue(page); // step 3, still exercise:'none' -- search hasn't been touched yet

    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(/\/app\/help/);
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('link', { name: 'Log', exact: true }).click();
    await expect(page.getByPlaceholder('Search all exercises')).toHaveValue('dead');
  });

  // The other half: an exercise open when the tour starts must reopen after Escape, even though
  // the tour's own arrange-effect calls backToPicker() internally for steps 1-4.
  test('restores the exercise that was open when the tour started', async ({ page, request }) => {
    await registerHousehold(page, request, 'Thaddeus', { keepWelcome: true });
    await dismissWelcomeAndSearch(page);

    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.locator(ANCHOR.setEntry)).toBeVisible();

    // Reachable from any screen -- the account menu is header chrome, not tab content.
    await openHelp(page);

    await page.getByRole('button', { name: 'Take the tour' }).click();
    await clickContinue(page);
    await clickContinue(page);

    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(/\/app\/help/);
    await page.getByRole('link', { name: 'Log', exact: true }).click();
    await expect(page.getByText('Barbell Bench Press', { exact: true })).toBeVisible();
    await expect(page.locator(ANCHOR.setEntry)).toBeVisible();
  });
});
