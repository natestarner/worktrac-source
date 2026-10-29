/* The marketing site's product images, captured from the reviewer demo household (Alex, Sam and
 * Jordan -- the same people the App Store screenshots show, made by tools/demo-household.mjs).
 * One household across the site and the store listing, and nobody's real family on a public page.
 *
 *   cd e2e
 *   FRONTEND=https://app.huddle.fitness EMAIL=... PASSWORD=... ALLOW_WRITES=1 \
 *     node tools/marketing-demo-shots.mjs ../marketing/assets
 *
 * Writes into <assetsDir>/shots/ and <assetsDir>/<OG_IMAGE>:
 *
 *   device-ipad.jpg      hero tablet: Alex mid-workout, iPad Air 11" landscape (1180 x 820)
 *   device-iphone.jpg    hero phone: the same workout on a 6.9" iPhone (440 x 956)
 *   app-log.jpg          "Log a set in two taps"
 *   app-trends-main.jpg  Sam's squat, est. 1RM climbing, with the all-time bests under it
 *   app-trends-secondary.jpg  Sam's workouts per week
 *   ...-phone.jpg        each of those three again at phone width, for <picture> on small screens:
 *                        a 1000px-wide capture shrunk to a phone's column leaves 5px text
 *   app-offline(-dark).png    the offline banner with two sets waiting, light and dark
 *   <OG_IMAGE>           the 1200 x 630 link preview, built from the hero phone capture
 *
 * "Everyone's in the huddle" is a video, not an image here: tools/marketing-demo-clip.mjs.
 *
 * The hero and log scenes LOG REAL SETS for Alex, so they need ALLOW_WRITES=1, refuse
 * to start if Alex already has a workout going, and delete exactly their own sets and end the
 * workout afterwards -- the same contract as tools/app-store-shots.mjs. The offline scene logs its
 * two sets with the network cut and closes the browser before reconnecting, so they never leave it.
 *
 * Device-framed images (the hero pair) are full screens at the device's real aspect ratio -- the
 * CSS bezel takes its shape from the image (.claude/rules/marketing.md). Each is captured at the
 * scale that makes the file exactly the size index.html declares, so nothing is resampled.
 *
 * FRONTEND_DIST=../frontend/dist serves the app's own files from a local build at FRONTEND's
 * origin, so a frontend fix can be captured before it is deployed. config.json and the API stay
 * FRONTEND's, and so does the origin, which is what its CORS allows. Service workers are blocked,
 * or the deployed one would answer from its own precache.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

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

// Chosen against Alex's seeded squat (best est. 1RM 277.5 = 225 x 7): working sets, not records.
const WORKING_SETS = [[225, 5], [225, 6]];
const EXERCISE = 'Barbell Back Squat';
const ROUTINE = 'Squat Day'; // Alex's, and it opens on EXERCISE

const TABLET = { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1700 / 1180, isMobile: true, hasTouch: true };
const PHONE = { viewport: { width: 440, height: 956 }, deviceScaleFactor: 800 / 440, isMobile: true, hasTouch: true };
// The plain figure cards: a tablet-width layout at 2x, downscaled by the <img> width/height, and the
// same cards at phone width for the page's small-screen <source>.
const FIGURE = { viewport: { width: 1000, height: 1100 }, deviceScaleFactor: 2 };
const FIGURE_PHONE = { viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await chromium.launch();
try {
  if (SCENES.includes('trends')) {
    for (const [device, suffix] of [[FIGURE, ''], [FIGURE_PHONE, '-phone']]) {
      const f = await open(device);
      await trends(f, suffix);
      await f.ctx.close();
    }
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
  const DIST = process.env.FRONTEND_DIST;
  const ctx = await browser.newContext({ ...device, colorScheme, ...(DIST && { serviceWorkers: 'block' }) });
  if (DIST) {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
    await ctx.route(`${FRONTEND}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/config.json') return route.continue();
      const file = join(DIST, path);
      const served = existsSync(file) && statSync(file).isFile() ? file : join(DIST, 'index.html'); // SPA fallback
      return route.fulfill({ body: readFileSync(served), contentType: types[extname(served)] ?? 'application/octet-stream' });
    });
  }
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
  // A bordered card, from its own top edge, cut off after `maxHeight` CSS px if it runs longer.
  //
  // A card that fits below the app's sticky chrome is centred there and shot as the app draws it.
  // Only a taller one gets the chrome demoted to static (or it paints over the card), because the
  // demotion leaves a stale page-wide hairline in Chromium's mobile emulation: the phone-width
  // weekly chart came out with its top 10px, the "4" and the tallest bars, under a line the app
  // never draws.
  const card = async (heading, path, maxHeight) => {
    const el = page.getByText(heading).first();
    await el.waitFor();
    const handle = await el.evaluateHandle((node) => {
      let target = node;
      while (target.parentElement && getComputedStyle(target).borderTopWidth === '0px') target = target.parentElement;
      return target;
    });
    // Centres the part that will be shot (the card can run on past maxHeight) in the space under
    // the chrome, when it fits there.
    const fits = await handle.evaluate((node, max) => {
      const chrome = Math.max(0, ...[...document.querySelectorAll('*')]
        .filter((e) => ['sticky', 'fixed'].includes(getComputedStyle(e).position) && e.getBoundingClientRect().top <= 0)
        .map((e) => e.getBoundingClientRect().bottom));
      const height = Math.min(node.getBoundingClientRect().height, max ?? Infinity);
      if (height > window.innerHeight - chrome) return false;
      window.scrollBy(0, node.getBoundingClientRect().top - (chrome + (window.innerHeight - chrome - height) / 2));
      return true;
    }, maxHeight);
    if (!fits) {
      await page.evaluate(() => {
        for (const e of document.querySelectorAll('*')) {
          const p = getComputedStyle(e).position;
          if (p === 'sticky' || p === 'fixed') e.style.position = 'static';
        }
      });
      await handle.evaluate((node) => node.scrollIntoView({ block: 'start' }));
    }
    await page.mouse.move(0, 0); // a pointer left over a chart leaves its hover tooltip in the shot
    await page.waitForTimeout(600);
    const box = await handle.boundingBox();
    const height = Math.min(box.height, maxHeight ?? box.height);
    // A fullPage capture lays the page out again at its full height, which moves the card out from
    // under a clip measured on screen, so only the card that cannot fit on screen uses one.
    await page.screenshot(fits
      ? { path, type: 'jpeg', quality: 88, clip: { x: box.x, y: box.y, width: box.width, height } }
      : { path, type: 'jpeg', quality: 88, fullPage: true, clip: { x: box.x, y: box.y + (await page.evaluate(() => window.scrollY)), width: box.width, height } });
    console.log(path);
  };
  return { settle, tab, person, openExercise, startRoutine, logSet, card };
}

async function trends({ page, person, tab, card }, suffix) {
  await person('Sam');
  await tab('Trends');
  await page.locator('select').last().selectOption({ label: EXERCISE });
  await page.waitForTimeout(800);
  // Down to the end of All-time bests: the chart and the records it names, not the lifetime table.
  const bests = await page.getByText(/^Most reps in a set$/).first().evaluate((el) => el.getBoundingClientRect().bottom);
  const top = await page.getByText(/^Exercise progress/).first().evaluate((el) => el.getBoundingClientRect().top);
  await card(/^Exercise progress/, join(SHOTS, `app-trends-main${suffix}.jpg`), bests - top + 44);
  await page.evaluate(() => window.scrollTo(0, 0));
  await card(/^Workouts per week$/, join(SHOTS, `app-trends-secondary${suffix}.jpg`));
}

async function workout(figure) {
  const tablet = await open(TABLET);
  await tablet.person('Alex');
  // Mid-routine on the tablet: the routine strip shows a feature the hero otherwise wouldn't, and
  // fills the landscape screen. Squat Day opens on the squat. Not on the phone, where the strip would
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

  // The log card comes from the same workout, at tablet and at phone width.
  await figureScenes(figure, '');
  const figurePhone = await open(FIGURE_PHONE);
  await figureScenes(figurePhone, '-phone');
  await figurePhone.ctx.close();
}

async function figureScenes(f, suffix) {
  // Reloaded first: a page that warmed its cache before the tablet logged anything would show the
  // workout empty.
  await f.page.reload();
  await f.settle();
  await f.person('Alex');
  await f.openExercise(EXERCISE);
  await f.page.getByText('Set 2', { exact: true }).waitFor();
  await f.page.evaluate(() => window.scrollTo(0, 0));
  const width = f.page.viewportSize().width;
  // Down past the sets just logged: the steppers, the button and what they produced are the pitch.
  // Not the Log set card's own edge: the sets card starts 17px under it, so any margin there shows
  // the next card's top edge, and no margin shows a card cut off at the frame.
  const logged = await f.page.getByText('Set 1', { exact: true }).evaluate((el) => {
    let card = el;
    while (card.parentElement && getComputedStyle(card).borderTopWidth === '0px') card = card.parentElement;
    return card.getBoundingClientRect().bottom;
  });
  await f.page.screenshot({ path: join(SHOTS, `app-log${suffix}.jpg`), type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width, height: Math.ceil(logged) + 24 } });
  console.log(`app-log${suffix}.jpg`);

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
// real hero phone capture, on the App Store art's cream ground. The phone wears the hero's bezel
// (styles.css .device--phone): warm near-black frame, a status band in the app header's white, and
// a drawn island -- bare, the capture read as a floating card rather than a phone.
//
// Messaging apps cache a preview by its image URL, and the site serves assets for a week, so a
// changed image under the same name keeps unfurling as the old one. Give each new image a new name,
// and point every page's og:image / twitter:image at it.
const OG_IMAGE = 'og-image-2026-10.png';
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
  .phone { position: absolute; left: 800px; top: 52px; width: 334px; padding: 11px; border-radius: 52px;
           background: linear-gradient(160deg, #33302b, #14130f);
           box-shadow: 0 30px 70px rgba(90, 50, 20, 0.3), 0 0 0 1px rgba(62, 58, 55, 0.25),
                       inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
  .screen { position: relative; overflow: hidden; border-radius: 41px; padding-top: 30px; background: #fff; line-height: 0; }
  .screen img { width: 100%; }
  .island { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); width: 92px; height: 26px;
            border-radius: 13px; background: #14130f; }
</style>
<i style="left:770px;top:150px;width:420px;height:420px;background:#E8734A"></i>
<i style="left:980px;top:40px;width:330px;height:330px;background:#F2A65A"></i>
<div class="copy"><img src="${lockup}" alt=""><h1>One screen, the whole family’s workout.</h1><p>Track and celebrate your PRs together.</p></div>
<div class="phone"><div class="screen"><span class="island"></span><img src="${phone}"></div></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(ASSETS, OG_IMAGE) });
  console.log(OG_IMAGE);
  await page.close();
}
