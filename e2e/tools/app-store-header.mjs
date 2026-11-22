/* The App Store product page header (App Store Connect → version → Header and Search Results).
 *
 *   FAMILY_PHOTO=<jpg> PHONE_BEZEL=<png> node tools/app-store-header.mjs <shotsDir> <outDir>
 *
 *   shotsDir      a raw/ folder from app-store-shots.mjs (uses iphone-01-log-mid-workout, the 6.9"
 *                 capture)
 *   FAMILY_PHOTO  Adobe Stock #509656928, the family of four (Standard license), from the same shoot
 *                 as the photo in app-store-photo-panels.mjs
 *   PHONE_BEZEL   Apple's "iPhone 18 Pro Max - Black - Portrait.png" (Bezel-iPhone-18.dmg), the same
 *                 frame the panels use
 *   Neither input is in this repo, and neither may be: the repo is public, the photo is licensed to
 *   Huddle, and Apple licenses its frames for App Store mock-ups only (docs/app-store-submission.md).
 *
 * 21:9, 3840 x 1646 PNG, no transparency (creative-assets-specifications). Apple crops the header
 * differently per device, so the lockup and headline sit inside the ART SAFE AREA from Apple's own
 * template (creative_assets-templates.sketch, "Header - 3840x1646"): 1646 x 661, centred, at
 * x 1097-2743, y 493-1154. An iPhone shows the full height and ~86% of the width (x ~269-3571).
 *
 * 2026-11-21: Nate chose this layout ("round 6, option 2") after six rounds of side-by-side mock-ups:
 *   - A warm CREAM ground, matching the app icon (the four circles on white), with the icon's four
 *     circles behind the photo at low opacity. Dark ink, "family's" in the brand's accessible rust.
 *   - The family of four in a rounded card on the right. The photo's dark gym ceiling cannot fade
 *     into cream (tried on the panels 2026-11-20: it always reads as a dark block), so the photo is
 *     CONTAINED in a shape, never faded into the ground.
 *   - The real log screen in Apple's iPhone frame, angled, rising from the bottom-left of the card
 *     over Mom's and the younger son's legs. It must never cover a face: the first cut put it on the
 *     right, over the dad.
 *   Rejected along the way, so they aren't proposed again: photo-only full-bleed headers, a photo on
 *   one side fading into charcoal, the father/son photo (it repeats screenshot 1 one scroll below),
 *   a couple instead of the family, terracotta grounds, the photo inside the headline's letters.
 *
 * No price, URL, copyright symbol or other platform anywhere. SAFE_AREA=1 draws the safe area (red)
 * and the iPhone's visible width (blue) on top, for checking only -- never upload that version.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [IN, OUT] = process.argv.slice(2);
const { FAMILY_PHOTO, PHONE_BEZEL } = process.env;
if (!IN || !OUT || !FAMILY_PHOTO || !PHONE_BEZEL) {
  throw new Error('usage: FAMILY_PHOTO=<jpg> PHONE_BEZEL=<png> node tools/app-store-header.mjs <shotsDir> <outDir>');
}
const [W, H] = [3840, 1646];
const SAFE = { x: 1097, y: 493, w: 1646, h: 661 };
const IPHONE_VISIBLE = { x: 269, w: 3302 };

const dataUrl = (file, type) => {
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  return `data:${type};base64,${readFileSync(file).toString('base64')}`;
};
const lockup = dataUrl(
  new URL('../../frontend/src/assets/huddle-lockup-horizontal-onlight.svg', import.meta.url),
  'image/svg+xml',
);
const logShot = dataUrl(join(IN, 'iphone-01-log-mid-workout.png'), 'image/png');

// Apple's frame and its screen opening; the 6.9" capture is the opening's width, so it drops in
// 1:1 below a drawn status bar. A frame of any other size is refused.
const FRAME = { w: 1470, h: 3000, x: 75, y: 66, radius: 190, screenW: 1320, screenH: 2868, sbar: 162 };
const bezel = readFileSync(PHONE_BEZEL);
if (bezel.readUInt32BE(16) !== FRAME.w || bezel.readUInt32BE(20) !== FRAME.h) {
  throw new Error(`PHONE_BEZEL must be Apple's ${FRAME.w} x ${FRAME.h} portrait PNG`);
}
const bezelUrl = `data:image/png;base64,${bezel.toString('base64')}`;

// The family photo. Its people span x .08-.92 of the frame (heads from y ~.25), so the card is
// laid out in those fractions; a different photo would need them re-measured. The size check
// keeps that from happening silently.
const PHOTO = { w: 3399, h: 5098, peopleX: [0.08, 0.92], top: 0.22 };
const photo = readFileSync(FAMILY_PHOTO);
const jpegSize = (b) => {
  for (let i = 2; i < b.length;) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error(`${FAMILY_PHOTO} is not a JPEG`);
};
const [pw0, ph0] = jpegSize(photo);
if (pw0 !== PHOTO.w || ph0 !== PHOTO.h) {
  throw new Error(`FAMILY_PHOTO must be Adobe Stock #509656928 (${PHOTO.w} x ${PHOTO.h}); got ${pw0} x ${ph0}`);
}
const photoUrl = `data:image/jpeg;base64,${photo.toString('base64')}`;

const CARD = { x: 1950, y: 140, w: 1600, h: 1366, radius: 64 };
const span = PHOTO.peopleX[1] - PHOTO.peopleX[0];
const bgW = CARD.w / span;
const bgH = (bgW * PHOTO.h) / PHOTO.w;
const cardBg = `url('${photoUrl}') ${-PHOTO.peopleX[0] * bgW}px ${-PHOTO.top * bgH}px / ${bgW}px ${bgH}px no-repeat`;

// The phone: centred at cx, its top edge at `top`, pivoting on its top centre.
const PHONE = { cx: 2230, top: 860, scale: 0.5, rotate: -8 };

// The icon's circles (logo units: cx, cy, r) behind the card, at low opacity.
const MARK = [[34, 36, 34, '#E8734A'], [92, 29, 29, '#F2A65A'], [32, 82, 25, '#F2EDE1'], [84, 80, 19, '#B5542D']];
const MARK_AT = { x: 2300, y: 40, scale: 15, opacity: 0.18 };
const circles = MARK.map(([cx, cy, r, c]) => {
  const { x, y, scale: s, opacity } = MARK_AT;
  return `<i class="c" style="left:${x + (cx - r) * s}px;top:${y + (cy - r) * s}px;width:${2 * r * s}px;height:${2 * r * s}px;background:${c};opacity:${opacity}"></i>`;
}).join('');

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@600;800&display=block">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body { position: relative; font-family: 'Barlow', sans-serif;
    background: radial-gradient(1700px 1300px at 63% 40%, #FBF8F2 0%, transparent 70%),
                linear-gradient(180deg, #F4EFE6 0%, #EDE6DA 100%); }
  .c { position: absolute; border-radius: 50%; }
  .card { position: absolute; left: ${CARD.x}px; top: ${CARD.y}px; width: ${CARD.w}px; height: ${CARD.h}px;
    border-radius: ${CARD.radius}px; background: ${cardBg};
    box-shadow: 0 40px 90px rgba(60, 40, 25, 0.22), 0 8px 20px rgba(60, 40, 25, 0.12); }
  .safe { position: absolute; left: ${SAFE.x}px; top: ${SAFE.y}px; height: ${SAFE.h}px;
    display: flex; flex-direction: column; justify-content: center; align-items: flex-start; }
  .safe img { height: 132px; margin-bottom: 40px; }
  h1 { color: #1c1b19; font-size: 160px; font-weight: 800; letter-spacing: -2px; line-height: 1; }
  em { font-style: normal; color: #8a3f20; }
  /* Apple's frame, unmodified; the capture sits behind its screen opening. */
  .dev { position: absolute; left: ${PHONE.cx - FRAME.w / 2}px; top: ${PHONE.top}px; width: ${FRAME.w}px; height: ${FRAME.h}px;
    transform: rotate(${PHONE.rotate}deg) scale(${PHONE.scale}); transform-origin: top center;
    filter: drop-shadow(0 60px 90px rgba(60, 40, 25, 0.3)); }
  .scr { position: absolute; left: ${FRAME.x}px; top: ${FRAME.y}px; width: ${FRAME.screenW}px; height: ${FRAME.screenH}px;
    background: #fff; overflow: hidden; border-radius: ${FRAME.radius}px; }
  .frame { position: absolute; left: 0; top: 0; width: ${FRAME.w}px; height: ${FRAME.h}px; }
  .sbar { height: ${FRAME.sbar}px; display: flex; justify-content: space-between; align-items: center;
    padding: 0 110px 0 150px; font: 600 54px 'Barlow', sans-serif; color: #1c1b19; background: #fff; }
  .batt { width: 78px; height: 38px; border: 4px solid #1c1b19; border-radius: 11px; }
  .shot { display: block; width: ${FRAME.screenW}px; height: ${FRAME.screenH - FRAME.sbar}px; object-fit: cover; object-position: top; }
  .debug { position: absolute; display: ${process.env.SAFE_AREA === '1' ? 'block' : 'none'}; }
</style>
${circles}
<div class="card"></div>
<div class="dev"><div class="scr"><div class="sbar"><span>9:41</span><span class="batt"></span></div><img class="shot" src="${logShot}"></div>
  <img class="frame" src="${bezelUrl}" alt=""></div>
<div class="safe"><img src="${lockup}" alt="Huddle"><h1>The whole<br><em>family’s</em><br>workout</h1></div>
<div class="debug" style="left:${SAFE.x}px;top:${SAFE.y}px;width:${SAFE.w}px;height:${SAFE.h}px;outline:6px dashed #d0021b"></div>
<div class="debug" style="left:${IPHONE_VISIBLE.x}px;top:0;width:${IPHONE_VISIBLE.w}px;height:${H}px;outline:6px dashed #00b7ff"></div>`);
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
// The type must fit the safe area; fail loudly rather than ship a clipped headline.
const fits = await page.evaluate(({ x, y, w, h }) => [...document.querySelectorAll('.safe > *')].every((el) => {
  const r = el.getBoundingClientRect();
  return r.left >= x && r.right <= x + w && r.top >= y && r.bottom <= y + h;
}), SAFE);
if (!fits) throw new Error('header content overflows the art safe area');
const name = process.env.SAFE_AREA === '1' ? 'header-21x9-SAFE-AREA-CHECK.png' : 'header-21x9.png';
const out = join(OUT, name);
await page.screenshot({ path: out });
const b = readFileSync(out);
if (b.readUInt32BE(16) !== W || b.readUInt32BE(20) !== H) throw new Error(`${out} is not ${W} x ${H}`);
if (b[25] !== 2) throw new Error(`${out} is not plain RGB (PNG colour type ${b[25]}); Apple rejects an alpha channel`);
console.log(name);
await browser.close();
