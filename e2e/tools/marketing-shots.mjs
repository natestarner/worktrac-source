/* Screenshot the REAL running app for the marketing site.
 *
 * Seed first with marketing-capture.mjs, then pass the household email it prints:
 *   cd e2e
 *   FRONTEND=http://localhost:3003 EMAIL=<seeded email> node tools/marketing-shots.mjs ../marketing/assets/shots
 *
 * SCHEME=dark captures the dark palette instead.
 *
 * Every product image on the landing page comes from here -- nothing is a mockup.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const FRONTEND = process.env.FRONTEND || 'http://localhost:3003';
const EMAIL = process.env.EMAIL;
const OUT = process.argv[2] || './shots';
const SCHEME = process.env.SCHEME === 'dark' ? 'dark' : 'light';
if (!EMAIL) throw new Error('EMAIL=<seeded household email> is required');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1000, height: 1100 },
  deviceScaleFactor: 2, // retina source; the page downscales via width/height attrs
  colorScheme: SCHEME,
});
const page = await ctx.newPage();

const sfx = SCHEME === 'dark' ? '-dark' : '';
// The app's sticky chrome (person bar, tab bar, session bar) paints OVER an element
// screenshot of anything taller than the viewport -- Playwright scrolls the element into view
// and the sticky layer follows it down. Demoting sticky/fixed to static for the capture
// removes the overlap without hiding or moving any content.
async function unstick() {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const p = getComputedStyle(el).position;
      if (p === 'sticky' || p === 'fixed') el.style.position = 'static';
    }
  });
}

// maxHeight crops a tall panel to its interesting top instead of trailing off into a long
// table -- a marketing image, not a full-page capture.
// offsetTop skips a band at the top of the element -- used to drop a filter/sort bar that is
// honest UI but a poor first impression in a marketing crop.
async function shot(name, locator, maxHeight, offsetTop = 0) {
  const target = !locator ? page : typeof locator === 'string' ? page.locator(locator).first() : locator;
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await unstick();
  await page.waitForTimeout(700);

  if (maxHeight) {
    // Pull the element's TOP to the top of the viewport first. scrollIntoViewIfNeeded centres a
    // tall element, which leaves its top above the viewport and a negative boundingBox().y --
    // clipping from there silently lopped the header off the line chart.
    await target.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await unstick();
    await page.waitForTimeout(500);

    let box = await target.boundingBox();
    if (box && box.y < 0) {
      await page.evaluate((dy) => window.scrollBy(0, dy), box.y);
      await page.waitForTimeout(300);
      box = await target.boundingBox();
    }
    if (box) {
      const top = Math.max(0, box.y) + offsetTop;
      const height = Math.min(box.height - offsetTop, maxHeight, page.viewportSize().height - top);
      await page.screenshot({
        path: `${OUT}/${name}${sfx}.png`,
        clip: { x: box.x, y: top, width: box.width, height },
      });
      console.log('  captured', name + sfx, `(${Math.round(height)}px of ${Math.round(box.height)}px)`);
      return;
    }
  }
  await target.screenshot({ path: `${OUT}/${name}${sfx}.png` });
  console.log('  captured', name + sfx);
}

// The Trends charts are NOT built on the shared Card primitive -- each is a plain div with
// inline surface/border/radius styles (see ConsistencyHeatmap.jsx). So anchor on the heading
// text and walk up two levels: heading -> its flex header row -> the card wrapper. That crops
// exactly one chart with its own border and radius intact, rather than a guessed bounding box.
const cardWith = (text) => page.getByText(text, { exact: false }).first().locator('xpath=../..');

await page.goto(`${FRONTEND}/login`);
await page.getByPlaceholder('Email').fill(EMAIL);
await page.getByPlaceholder('Password').fill('password123');
await page.getByRole('button', { name: /log in|sign in/i }).click();
await page.waitForURL(/\/app\//, { timeout: 20_000 });
await page.waitForTimeout(3000); // let the offline cache warm against seeded data

// ---------------------------------------------------------------- log screen
await page.goto(`${FRONTEND}/app/log`);
await page.waitForTimeout(1500);

// Dismiss the "create a routine" nudge -- it is a first-run tip, not part of the product
// story these images are telling.
for (const close of await page.getByRole('button', { name: /dismiss|close/i }).all()) {
  await close.click().catch(() => {});
}
await page.waitForTimeout(400);
// Open the exercise from the PICKER, not by first text match. Once a session is live the
// exercise name also appears in the "Session exercises" card at the top, and .first() matched
// that instead -- leaving the capture on the picker screen rather than the log screen.
const benchChip = page.getByRole('button', { name: 'Barbell Bench Press' }).last();
if (await benchChip.isVisible().catch(() => false)) {
  await benchChip.click();
} else {
  await page.getByText('Barbell Bench Press', { exact: true }).last().click().catch(() => {});
}
await page.waitForTimeout(1800);
await shot('app-log', '.tab-panel', 900);

// The person bar on its own: three names, one device -- the household story in one strip.
// Anchored on "+ Add person" and walked up to the row that holds all the pills.
await shot('app-people', page.getByText('+ Add person').first().locator('xpath=..'));

// ---------------------------------------------------------------- PRs
await page.goto(`${FRONTEND}/app/prs`);
await page.waitForTimeout(2000);
// Skip the sort + search bar: honest UI, but it should not be the first thing a visitor
// sees of the PRs board.
await shot('app-prs', '.tab-panel', 700, 150);

// ---------------------------------------------------------------- trends
await page.goto(`${FRONTEND}/app/trends`);
await page.waitForTimeout(2800);

await shot('app-heatmap', cardWith('Consistency'));
await shot('app-weekly', cardWith('Workouts per week'));

// The line chart -- pick a recognisable lift rather than whatever sorts first.
const picker = page.locator('select').last();
for (const want of ['Barbell Bench Press', 'Barbell Back Squat', 'Barbell Deadlift']) {
  const options = await picker.locator('option').allTextContents();
  if (options.some((o) => o.trim() === want)) {
    await picker.selectOption({ label: want });
    break;
  }
}
await page.waitForTimeout(2200); // Recharts enter animation
await shot('app-linechart', cardWith('Exercise progress'), 480);

// ---------------------------------------------------------------- offline
// A genuine offline capture: cut the network, log a real set, and screenshot the outbox
// banner the app actually shows. This is the one claim on the landing page that would be
// embarrassing to illustrate with a mockup.
await page.goto(`${FRONTEND}/app/log`);
await page.waitForTimeout(1500);
await ctx.setOffline(true);

const benchAgain = page.getByText('Barbell Bench Press', { exact: true }).first();
if (await benchAgain.isVisible().catch(() => false)) {
  await benchAgain.click();
  await page.waitForTimeout(1200);
  const logBtn = page.getByRole('button', { name: /^Log set for/ }).first();
  if (await logBtn.isVisible().catch(() => false)) {
    await logBtn.click();
    await page.waitForTimeout(1200);
    await logBtn.click();
    await page.waitForTimeout(1800);
  }
}
// Deliberately NOT an element crop: the "changes waiting to sync" banner lives in the app
// chrome above .tab-panel, and the banner is the whole point of this image.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/app-offline${sfx}.png`, clip: { x: 0, y: 0, width: 1000, height: 560 } });
console.log('  captured app-offline' + sfx);
await ctx.setOffline(false);

// End the session this script started. Without it the live session survives into the next run
// and changes what the Log tab opens to, which silently turned app-log into a picker
// screenshot once already.
await page.waitForTimeout(2500); // let the queued sets drain first
const endWorkout = page.getByRole('button', { name: /end workout/i }).first();
if (await endWorkout.isVisible().catch(() => false)) {
  await endWorkout.click().catch(() => {});
  await page.waitForTimeout(800);
  const confirm = page.getByRole('button', { name: /^end workout$|^end$|confirm/i }).last();
  await confirm.click().catch(() => {});
  await page.waitForTimeout(1200);
}

await browser.close();
console.log('done');
