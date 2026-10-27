/* App Store screenshots of the real app, at the pixel sizes App Store Connect asks for.
 *
 * Signs in to an existing household (the reviewer demo, or a local copy made by
 * tools/demo-household.mjs) and captures each screen at:
 *
 *   iphone  6.9" display  440 x 956 CSS px @3x = 1320 x 2868   (required)
 *   ipad    13" display  1032 x 1376 CSS px @2x = 2064 x 2752  (required: Huddle runs on iPad)
 *
 * Usage (from e2e/):
 *   FRONTEND=http://localhost:3001 EMAIL=... PASSWORD=... node tools/app-store-shots.mjs <outDir>
 *
 *   DEVICES=iphone,ipad     which sizes (default both)
 *   ALLOW_WRITES=1          also capture the two scenes that have to LOG A SET -- mid-workout with
 *                           the rest timer running, and the PR celebration. Off by default, so
 *                           pointing this at the production reviewer account changes nothing; on
 *                           for a local copy.
 *
 * Every image is a capture of the running app -- no mockups -- the same rule the marketing site's
 * screenshots follow (docs/marketing-site.md). The iOS status bar is not drawn: these are web
 * captures at device size, and a hand-drawn status bar would be exactly the kind of mockup that
 * rule exists to keep out.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const FRONTEND = process.env.FRONTEND || 'http://localhost:3001';
const OUT = process.argv[2] || './app-store-shots';
const { EMAIL, PASSWORD } = process.env;
const ALLOW_WRITES = process.env.ALLOW_WRITES === '1';
const DEVICES = {
  iphone: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const which = (process.env.DEVICES || 'iphone,ipad').split(',');
if (!EMAIL || !PASSWORD) throw new Error('set EMAIL and PASSWORD for the household to capture');

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// Every device's read-only screens come first. A logged set starts a workout on the SERVER, and
// from then on every screen on every device carries the "Session in progress" bar -- so the
// set-logging scenes run last, once, on the first device.
for (const device of which) await capture(device, false);
if (ALLOW_WRITES) await capture(which[0], true);
await browser.close();

async function capture(device, writes) {
  const ctx = await browser.newContext({ ...DEVICES[device], colorScheme: 'light' });
  const page = await ctx.newPage();
  const shot = async (name) => {
    await page.waitForTimeout(800); // let charts and the refresh indicator settle
    await page.screenshot({ path: `${OUT}/${device}-${name}.png` });
    console.log(`${device}-${name}.png`);
  };
  const tab = async (name) => {
    await page.getByRole('link', { name, exact: true }).click();
    await page.waitForLoadState('networkidle');
    // The app keeps the window's scroll position across a tab switch, so a tab opened after the
    // scrolled Trends chart would be captured partway down. Every screen starts from its top.
    await page.evaluate(() => window.scrollTo(0, 0));
  };

  await page.goto(`${FRONTEND}/login`);
  await page.getByPlaceholder('Email').fill(EMAIL);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByPlaceholder('Password').press('Enter');
  await page.waitForURL(/\/app\//, { timeout: 60_000 });
  await page.waitForLoadState('networkidle');

  const openSquat = async () => {
    await tab('Log');
    const backToPicker = page.getByRole('button', { name: /All exercises/ });
    if (await backToPicker.isVisible()) await backToPicker.click();
    await page.getByRole('button', { name: 'Barbell Back Squat', exact: true }).first().click();
    await page.getByRole('button', { name: /^Log set/ }).waitFor();
  };

  if (writes) {
    await openSquat();
    // Mid-workout: one set at what the screen prefilled, so the rest timer is running.
    await page.getByRole('button', { name: /^Log set/ }).click();
    await page.getByText('Set 1', { exact: true }).waitFor();
    await page.waitForTimeout(4000); // a few seconds on the rest clock reads as real
    await shot('1-log-mid-workout');

    // A record: a heavier set than any before it.
    const weight = page.getByRole('textbox', { name: 'Weight (lb)' });
    await weight.fill('245');
    await weight.press('Enter');
    const reps = page.getByRole('textbox', { name: 'Reps' });
    await reps.fill('5');
    await reps.press('Enter');
    await page.getByRole('button', { name: /^Log set/ }).click();
    await page.getByText('New PR!').waitFor();
    await page.waitForTimeout(1200); // past the entrance animation
    await shot('2-pr-celebration');
    await page.getByText('New PR!').click({ force: true });
    await ctx.close();
    return;
  }

  await tab('History');
  await shot('3-history');

  await tab('Trends');
  await shot('4-trends');
  await page.locator('select').last().selectOption({ label: 'Barbell Back Squat' });
  // Park the chart's card just under the sticky chrome, so the whole chart is on screen.
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('*')].find((el) =>
      el.childElementCount === 0 && el.textContent.startsWith('Exercise progress'));
    const card = heading.closest('section, [class*="card"]') ?? heading.parentElement.parentElement;
    const chromeBottom = document.querySelector('.app-chrome')?.getBoundingClientRect().bottom ?? 0;
    window.scrollBy(0, card.getBoundingClientRect().top - chromeBottom - 12);
  });
  await shot('5-trends-exercise');

  await tab('PRs');
  await shot('6-prs');

  await tab('Routines');
  await shot('7-routines');

  // Log: the exercise screen before a set -- Last time, Best, the steppers.
  await openSquat();
  await shot('1-log');

  await ctx.close();
}
