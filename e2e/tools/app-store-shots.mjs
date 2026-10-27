/* App Store screenshots of the real app, at the pixel sizes App Store Connect asks for.
 *
 * Signs in to an existing household (the reviewer demo, or a local copy made by
 * tools/demo-household.mjs) and captures each screen at:
 *
 *   iphone63  Dynamic Island, medium  402 x 874 CSS px @3x = 1206 x 2622  (REQUIRED: App Store
 *             Connect's default iPhone slot, the iPhone 17 Pro / 16 Pro size)
 *   iphone    Dynamic Island, large   440 x 956 CSS px @3x = 1320 x 2868  (optional: Pro Max, under
 *             "View All Sizes in Media Manager")
 *   ipad    13" display  1032 x 1376 CSS px @2x = 2064 x 2752  (required: Huddle runs on iPad)
 *
 * Usage (from e2e/):
 *   FRONTEND=https://app.huddle.fitness EMAIL=... PASSWORD=... node tools/app-store-shots.mjs <outDir>
 *
 *   DEVICES=iphone63,iphone,ipad   which sizes (default all three)
 *   API=...                 the backend origin; default: the frontend's /config.json apiUrl
 *   ALLOW_WRITES=1          also capture the two scenes that have to LOG A SET -- mid-workout with
 *                           the rest timer running, and the PR celebration. Off by default, so
 *                           pointing this at the production reviewer account changes nothing.
 *
 * Files are numbered in STORE order, not capture order: only the first two or three show in search
 * results, so they carry the pitch (log fast, celebrate records, watch strength climb).
 *
 * Framing: a screen that opens on chrome a buyer doesn't care about (a Free-plan notice, filters,
 * action buttons) is scrolled so its best content sits just under the sticky person/tab bar. That
 * is a scroll position anyone can reach, not an edit -- nothing on the page is hidden or restyled.
 *
 * The write scenes log three Back Squat sets for Alex (the third one a real est.-1RM record), then
 * DELETE exactly those sets and end the workout, so the reviewer account goes back to its seeded
 * state. They refuse to run if Alex already has a workout in progress -- that would be someone
 * else's, and the cleanup would delete it.
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
  iphone63: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  iphone: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const which = (process.env.DEVICES || 'iphone63,iphone,ipad').split(',');
if (!EMAIL || !PASSWORD) throw new Error('set EMAIL and PASSWORD for the household to capture');
const API = process.env.API || (await (await fetch(`${FRONTEND}/config.json`)).json()).apiUrl;

// The write scenes' sets, chosen against Alex's seeded squat (best est. 1RM 277.5 = 225 x 7): two
// working sets that are not records, then one that is (235 x 6 = est. 282).
const WORKING_SETS = [[225, 5], [225, 6]];
const RECORD_SET = [235, 6];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const device of which) await capture(device);
} finally {
  await browser.close();
}

async function capture(device) {
  const ctx = await browser.newContext({ ...DEVICES[device], colorScheme: 'light' });
  const page = await ctx.newPage();

  // Loaded means no skeleton anywhere and the network quiet -- a shot taken a beat early shows grey
  // placeholder bars where Last time and Best belong.
  const settle = async () => {
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !document.querySelector('[class*="skeleton" i]'), null, { timeout: 30_000 });
    await page.waitForTimeout(800); // charts and the refresh indicator
  };
  const shot = async (name) => {
    await settle();
    await page.screenshot({ path: `${OUT}/${device}-${name}.png` });
    console.log(`${device}-${name}.png`);
  };
  const tab = async (name) => {
    await page.getByRole('link', { name, exact: true }).click();
    await settle();
    // The app keeps the window's scroll position across a tab switch; every screen starts from its top.
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  const person = async (name) => {
    await page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) }).click();
    await settle();
  };
  // Scroll so `locator`'s top sits `gap` CSS px under the sticky chrome. Repeats because charts lay
  // out lazily as they scroll in, which moves everything below them after the first scroll.
  // With `card`, the edge parked is the bordered card around the text, not the text itself -- so
  // the gap above it is the page's own spacing and no sliver of the card above shows.
  const park = async (locator, gap, { card = false } = {}) => {
    await locator.waitFor();
    for (let i = 0; i < 5; i++) {
      const delta = await locator.evaluate((el, [g, toCard]) => {
        let target = el;
        while (toCard && target.parentElement && getComputedStyle(target).borderTopWidth === '0px') target = target.parentElement;
        const chrome = document.querySelector('.app-chrome')?.getBoundingClientRect().bottom ?? 0;
        return target.getBoundingClientRect().top - chrome - g;
      }, [gap, card]);
      if (Math.abs(delta) < 1) return;
      await page.evaluate((d) => window.scrollBy(0, d), delta);
      await page.waitForTimeout(400);
    }
  };
  const openExercise = async (name) => {
    await tab('Log');
    const backToPicker = page.getByRole('button', { name: /All exercises/ });
    if (await backToPicker.isVisible()) await backToPicker.click();
    await page.getByRole('button', { name, exact: true }).first().click();
    await page.getByRole('button', { name: /^Log set/ }).waitFor();
    await settle();
  };

  await page.goto(`${FRONTEND}/login`);
  await page.getByPlaceholder('Email').fill(EMAIL);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByPlaceholder('Password').press('Enter');
  await page.waitForURL(/\/app\//, { timeout: 60_000 });
  await settle();

  // ---- read-only scenes, before anything is logged (a live workout puts its bar on every screen)
  await person('Sam');
  await tab('Trends');
  await page.locator('select').last().selectOption({ label: 'Barbell Back Squat' });
  if (device.startsWith('iphone')) {
    await park(page.getByText(/^Exercise progress/).first(), 12, { card: true });
    await shot('03-progress-chart');
    await page.evaluate(() => window.scrollTo(0, 0));
    // Below Streak and This week: a Tuesday-morning "0 workouts, -4 vs last week" is no pitch.
    await park(page.getByText(/^Volume · last 30 days$/i).first(), 12, { card: true });
  } else {
    // The iPad lays Streak, This week and Volume out as one row, and the page is too short to park
    // the progress chart at the top -- so one Trends shot, from the heatmap down: the weekly bars
    // and the squat chart both fit under it.
    await park(page.getByText(/^Consistency/).first(), 12, { card: true });
  }
  await shot('04-trends-overview');

  await person('Alex');
  await tab('PRs');
  await park(page.getByText('Record', { exact: true }).first(), 12);
  await shot('05-prs');

  await tab('History');
  await park(page.getByText(/ · \d{1,2}:\d{2} [AP]M$/).first(), 12);
  await shot('06-history');

  await tab('Log');
  const backToPicker = page.getByRole('button', { name: /All exercises/ });
  if (await backToPicker.isVisible()) await backToPicker.click();
  await shot('07-start-workout');

  if (ALLOW_WRITES) await writeScenes();
  await ctx.close();

  async function writeScenes() {
    const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
    const call = async (method, path) => {
      const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
      return res.status === 204 ? null : res.json();
    };
    const alex = (await call('GET', '/api/people')).find((p) => p.name === 'Alex');
    if (await call('GET', `/api/people/${alex.id}/sessions/live`)) {
      throw new Error('Alex already has a workout in progress -- not logging over it (and not deleting it)');
    }
    try {
      await openExercise('Barbell Back Squat');
      // The 6.3" screen is shorter: a second set row would sit under the session bar, so it logs one.
      for (const [w, r] of device === 'iphone63' ? WORKING_SETS.slice(0, 1) : WORKING_SETS) await logSet(w, r);
      // A minute on the rest clock reads as the middle of a workout; a few seconds reads as a demo.
      await page.waitForTimeout(72_000);
      await shot('01-log-mid-workout');

      await logSet(...RECORD_SET);
      await page.getByText('New PR!').waitFor();
      await page.waitForTimeout(1200); // past the entrance animation, confetti still falling
      await page.screenshot({ path: `${OUT}/${device}-02-pr-celebration.png` });
      console.log(`${device}-02-pr-celebration.png`);
      await page.keyboard.press('Escape');
    } finally {
      // Delete exactly this run's sets (the guard above means the live workout is ours), then end it.
      const live = await call('GET', `/api/people/${alex.id}/sessions/live`);
      if (live) {
        await page.waitForLoadState('networkidle');
        const squat = (await call('GET', `/api/people/${alex.id}/exercises`)).find((e) => e.name === 'Barbell Back Squat');
        for (const s of await call('GET', `/api/sessions/${live.id}/sets?exerciseId=${squat.id}`)) {
          await call('DELETE', `/api/sets/${s.id}`);
        }
        await call('POST', `/api/people/${alex.id}/sessions/live/end`);
        console.log(`cleaned up: workout ${live.id} emptied and ended`);
      }
    }
  }

  async function logSet(weight, reps) {
    const before = await page.getByText(/^Set \d+$/).count();
    for (const [label, value] of [['Weight (lb)', weight], ['Reps', reps]]) {
      const box = page.getByRole('textbox', { name: label });
      await box.fill(String(value));
      await box.press('Enter');
    }
    await page.getByRole('button', { name: /^Log set/ }).click();
    await page.getByText(`Set ${before + 1}`, { exact: true }).waitFor();
  }
}
