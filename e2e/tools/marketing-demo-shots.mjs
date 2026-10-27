/* The marketing site's product images, captured from the reviewer demo household (Alex, Sam and
 * Jordan -- the same people the App Store screenshots show, made by tools/demo-household.mjs).
 * One household across the site and the store listing, and nobody's real family on a public page.
 *
 *   cd e2e
 *   FRONTEND=https://app.huddle.fitness EMAIL=... PASSWORD=... ALLOW_WRITES=1 \
 *     node tools/marketing-demo-shots.mjs ../marketing/assets
 *
 * Writes into <assetsDir>/shots/ and <assetsDir>/og-image.png:
 *
 *   device-ipad.jpg      hero tablet: Alex mid-workout, iPad Air 11" landscape (1180 x 820)
 *   device-iphone.jpg    hero phone: the same workout on a 6.9" iPhone (440 x 956)
 *   app-log.jpg          "Log a set in two taps"
 *   app-household.jpg    "Everyone's in the huddle": the New PR! celebration, pills above it
 *   app-trends-main.jpg  Sam's squat, est. 1RM climbing, with the all-time bests under it
 *   app-trends-secondary.jpg  Sam's workouts per week
 *   app-offline(-dark).png    the offline banner with two sets waiting, light and dark
 *   og-image.png         the 1200 x 630 link preview, built from the hero phone capture
 *
 * The hero, log and celebration scenes LOG REAL SETS for Alex, so they need ALLOW_WRITES=1, refuse
 * to start if Alex already has a workout going, and delete exactly their own sets and end the
 * workout afterwards -- the same contract as tools/app-store-shots.mjs. The offline scene logs its
 * two sets with the network cut and closes the browser before reconnecting, so they never leave it.
 *
 * Device-framed images (the hero pair) are full screens at the device's real aspect ratio -- the
 * CSS bezel takes its shape from the image (.claude/rules/marketing.md). Each is captured at the
 * scale that makes the file exactly the size index.html declares, so nothing is resampled.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = process.env.FRONTEND || 'https://app.huddle.fitness';
const ASSETS = process.argv[2];
const { EMAIL, PASSWORD } = process.env;
if (!ASSETS || !EMAIL || !PASSWORD) throw new Error('usage: EMAIL=... PASSWORD=... node tools/marketing-demo-shots.mjs <assetsDir>');
// SCENES=trends,offline,og re-takes only the scenes that write nothing -- for when the demo account
// is in use (App Review signs in to it) and logging sets there would show up on their screen.
const SCENES = (process.env.SCENES || 'trends,workout,offline,og').split(',');
if (SCENES.includes('workout') && process.env.ALLOW_WRITES !== '1') {
  throw new Error('the workout scene logs real sets: set ALLOW_WRITES=1, or leave it out of SCENES');
}
const SHOTS = join(ASSETS, 'shots');
mkdirSync(SHOTS, { recursive: true });
const API = (await (await fetch(`${FRONTEND}/config.json`)).json()).apiUrl;

// Chosen against Alex's seeded squat (best est. 1RM 277.5 = 225 x 7): working sets that are not
// records, then one that is (235 x 6 = est. 282).
const WORKING_SETS = [[225, 5], [225, 6]];
const RECORD_SET = [235, 6];
const EXERCISE = 'Barbell Back Squat';
const ROUTINE = 'Lower A'; // Alex's, and it opens on EXERCISE

const TABLET = { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1700 / 1180, isMobile: true, hasTouch: true };
const PHONE = { viewport: { width: 440, height: 956 }, deviceScaleFactor: 800 / 440, isMobile: true, hasTouch: true };
// The plain figure cards: a tablet-width layout at 2x, downscaled by the <img> width/height.
const FIGURE = { viewport: { width: 1000, height: 1100 }, deviceScaleFactor: 2 };

const browser = await chromium.launch();
try {
  if (SCENES.includes('trends')) {
    const figure = await open(FIGURE);
    await trends(figure);
    await figure.ctx.close();
  }
  if (SCENES.includes('workout')) await workoutScenes();
  if (SCENES.includes('offline')) for (const scheme of ['light', 'dark']) await offline(scheme);
  if (SCENES.includes('og')) await ogImage();
} finally {
  await browser.close();
}

async function workoutScenes() {
  const figure = await open(FIGURE);
  const token = await figure.page.evaluate(() => localStorage.getItem('workout-tracker-token'));
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
    await workout(figure);
  } finally {
    const live = await call('GET', `/api/people/${alex.id}/sessions/live`);
    if (live) {
      const squat = (await call('GET', `/api/people/${alex.id}/exercises`)).find((e) => e.name === EXERCISE);
      for (const s of await call('GET', `/api/sessions/${live.id}/sets?exerciseId=${squat.id}`)) {
        await call('DELETE', `/api/sets/${s.id}`);
      }
      await call('POST', `/api/people/${alex.id}/sessions/live/end`);
      console.log(`cleaned up: workout ${live.id} emptied and ended`);
    }
  }
  await figure.ctx.close();
}

async function open(device, colorScheme = 'light') {
  const ctx = await browser.newContext({ ...device, colorScheme });
  const page = await ctx.newPage();
  const helpers = drive(page);
  await page.goto(`${FRONTEND}/login`);
  await page.getByPlaceholder('Email').fill(EMAIL);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByPlaceholder('Password').press('Enter');
  await page.waitForURL(/\/app\//, { timeout: 60_000 });
  await helpers.settle();
  return { ctx, page, ...helpers };
}

function drive(page) {
  const settle = async () => {
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !document.querySelector('[class*="skeleton" i]'), null, { timeout: 30_000 });
    await page.waitForTimeout(800);
  };
  const tab = async (name) => {
    await page.getByRole('link', { name, exact: true }).click();
    await settle();
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  const person = async (name) => {
    await page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) }).click();
    await settle();
  };
  const openExercise = async (name) => {
    await tab('Log');
    const backToPicker = page.getByRole('button', { name: /All exercises/ });
    if (await backToPicker.isVisible()) await backToPicker.click();
    await page.getByRole('button', { name, exact: true }).first().click();
    await page.getByRole('button', { name: /^Log set/ }).waitFor();
    await settle();
  };
  // Starting a routine is device-local state (no request), and opens its first exercise.
  const startRoutine = async (name) => {
    await tab('Log');
    const backToPicker = page.getByRole('button', { name: /All exercises/ });
    if (await backToPicker.isVisible()) await backToPicker.click();
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await page.getByRole('button', { name: /^Log set/ }).waitFor();
    await settle();
  };
  const logSet = async (weight, reps, { wait = true } = {}) => {
    const before = await page.getByText(/^Set \d+$/).count();
    for (const [label, value] of [['Weight (lb)', weight], ['Reps', reps]]) {
      const box = page.getByRole('textbox', { name: label });
      await box.fill(String(value));
      await box.press('Enter');
    }
    await page.getByRole('button', { name: /^Log set/ }).click();
    if (wait) await page.getByText(`Set ${before + 1}`, { exact: true }).waitFor();
  };
  // A bordered card, from its own top edge, cut off after `rows` CSS px if it runs longer. The app's
  // sticky chrome is demoted first, or it paints over any element taller than the viewport.
  const card = async (heading, path, maxHeight) => {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const p = getComputedStyle(el).position;
        if (p === 'sticky' || p === 'fixed') el.style.position = 'static';
      }
    });
    const el = page.getByText(heading).first();
    await el.waitFor();
    const handle = await el.evaluateHandle((node) => {
      let target = node;
      while (target.parentElement && getComputedStyle(target).borderTopWidth === '0px') target = target.parentElement;
      return target;
    });
    await handle.evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.mouse.move(0, 0); // a pointer left over a chart leaves its hover tooltip in the shot
    await page.waitForTimeout(600);
    const box = await handle.boundingBox();
    await page.screenshot({
      path, type: 'jpeg', quality: 88, fullPage: true,
      clip: { x: box.x, y: box.y + (await page.evaluate(() => window.scrollY)), width: box.width, height: Math.min(box.height, maxHeight ?? box.height) },
    });
    console.log(path);
  };
  return { settle, tab, person, openExercise, startRoutine, logSet, card };
}

async function trends({ page, person, tab, card }) {
  await person('Sam');
  await tab('Trends');
  await page.locator('select').last().selectOption({ label: EXERCISE });
  await page.waitForTimeout(800);
  // Down to the end of All-time bests: the chart and the records it names, not the lifetime table.
  const bests = await page.getByText(/^Most reps in a set$/).first().evaluate((el) => el.getBoundingClientRect().bottom);
  const top = await page.getByText(/^Exercise progress/).first().evaluate((el) => el.getBoundingClientRect().top);
  await card(/^Exercise progress/, join(SHOTS, 'app-trends-main.jpg'), bests - top + 44);
  await page.evaluate(() => window.scrollTo(0, 0));
  await card(/^Workouts per week$/, join(SHOTS, 'app-trends-secondary.jpg'));
}

async function workout(figure) {
  const tablet = await open(TABLET);
  await tablet.person('Alex');
  // Mid-routine on the tablet: the routine strip shows a feature the hero otherwise wouldn't, and
  // fills the landscape screen. Lower A opens on the squat. Not on the phone, where the strip would
  // push the logged sets off the screen.
  await tablet.startRoutine(ROUTINE);
  for (const [w, r] of WORKING_SETS) await tablet.logSet(w, r);
  await tablet.page.waitForTimeout(45_000); // the rest ring part-way round reads as mid-workout
  await tablet.settle();
  await tablet.page.screenshot({ path: join(SHOTS, 'device-ipad.jpg'), type: 'jpeg', quality: 88 });
  console.log('device-ipad.jpg');

  const phone = await open(PHONE);
  await phone.person('Alex');
  await phone.openExercise(EXERCISE);
  await phone.page.getByText('Set 2', { exact: true }).waitFor();
  await phone.page.screenshot({ path: join(SHOTS, 'device-iphone.jpg'), type: 'jpeg', quality: 88 });
  console.log('device-iphone.jpg');
  await phone.ctx.close();
  await tablet.ctx.close();

  // The figure cards come from the same workout, on the plain 1000px layout.
  await figure.person('Alex');
  await figure.openExercise(EXERCISE);
  await figure.page.getByText('Set 2', { exact: true }).waitFor();
  await figure.page.evaluate(() => window.scrollTo(0, 0));
  // Down to the Log set card's bottom edge: the steppers and the button are the pitch.
  const logged = await figure.page.getByRole('button', { name: /^Log set/ }).evaluate((el) => {
    let card = el;
    while (card.parentElement && getComputedStyle(card).borderTopWidth === '0px') card = card.parentElement;
    return card.getBoundingClientRect().bottom;
  });
  await figure.page.screenshot({ path: join(SHOTS, 'app-log.jpg'), type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 1000, height: Math.ceil(logged) + 24 } });
  console.log('app-log.jpg');

  await figure.logSet(...RECORD_SET);
  await figure.page.getByText('New PR!').waitFor();
  await figure.page.waitForTimeout(1200); // past the entrance animation, confetti still falling
  await figure.page.screenshot({ path: join(SHOTS, 'app-household.jpg'), type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 1000, height: 900 } });
  console.log('app-household.jpg');
  await figure.page.keyboard.press('Escape');
  await figure.page.waitForLoadState('networkidle');
}

// Two sets logged with the network cut, so the app's own banner says what is waiting. The context
// is closed while still offline: the queued sets live only in this throwaway browser profile.
async function offline(scheme) {
  // Narrower than the other cards, so the banner -- the whole point -- stays legible at the size the
  // page shows it, and the two waiting sets fit under it.
  const s = await open({ viewport: { width: 600, height: 1100 }, deviceScaleFactor: 2 }, scheme);
  await s.person('Alex');
  await s.openExercise('Barbell Bench Press');
  await s.ctx.setOffline(true);
  await s.logSet(135, 8, { wait: false });
  await s.page.getByText('Set 1', { exact: true }).waitFor();
  await s.logSet(135, 8, { wait: false });
  await s.page.getByText(/2 changes waiting/).first().waitFor();
  await s.page.mouse.move(0, 0);
  await s.page.waitForTimeout(800);
  const bottom = await s.page.getByText('Set 1', { exact: true }).evaluate((el) => {
    let card = el;
    while (card.parentElement && getComputedStyle(card).borderTopWidth === '0px') card = card.parentElement;
    return card.getBoundingClientRect().bottom + window.scrollY;
  });
  const name = scheme === 'dark' ? 'app-offline-dark.png' : 'app-offline.png';
  await s.page.screenshot({ path: join(SHOTS, name), fullPage: true, clip: { x: 0, y: 0, width: 600, height: Math.ceil(bottom) + 20 } });
  console.log(name);
  await s.ctx.close();
}

// The card a shared link unfurls into (iMessage, Slack, social): the site's hero line beside the
// real hero phone capture, on the App Store art's cream ground.
async function ogImage() {
  const data = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
  const lockup = data(new URL('../../frontend/src/assets/huddle-lockup-horizontal-onlight.svg', import.meta.url), 'image/svg+xml');
  const phone = data(join(SHOTS, 'device-iphone.jpg'), 'image/jpeg');
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;700&display=block">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { position: relative; width: 1200px; height: 630px; overflow: hidden; font-family: 'Barlow', sans-serif;
         background: linear-gradient(165deg, #fbf8f3 0%, #f4ebe0 100%); }
  i { position: absolute; border-radius: 50%; opacity: 0.1; }
  .copy { position: absolute; left: 80px; top: 0; bottom: 0; width: 640px; display: flex; flex-direction: column; justify-content: center; }
  .copy img { height: 64px; align-self: flex-start; margin-bottom: 40px; }
  h1 { color: #3e3a37; font-size: 68px; font-weight: 700; line-height: 1.04; letter-spacing: -0.015em; }
  p { color: #6e655e; margin-top: 22px; font-size: 30px; font-weight: 500; }
  .phone { position: absolute; left: 812px; top: 64px; width: 310px; border-radius: 40px;
           box-shadow: 0 30px 70px rgba(90, 50, 20, 0.25), 0 0 0 1px rgba(62, 58, 55, 0.1); }
</style>
<i style="left:770px;top:150px;width:420px;height:420px;background:#E8734A"></i>
<i style="left:980px;top:40px;width:330px;height:330px;background:#F2A65A"></i>
<div class="copy"><img src="${lockup}" alt=""><h1>One screen, the whole family’s workout.</h1><p>Track and celebrate your PRs together.</p></div>
<img class="phone" src="${phone}">`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(ASSETS, 'og-image.png') });
  console.log('og-image.png');
  await page.close();
}
