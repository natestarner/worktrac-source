/* The App Store product page header (App Store Connect → version → Header and Search Results).
 *
 *   node tools/app-store-header.mjs <shotsDir> <outDir>
 *
 * 21:9, 3840 x 1646 PNG, no transparency (creative-assets-specifications). Apple crops the header
 * differently per device, so everything that must be seen sits inside the ART SAFE AREA from Apple's
 * own template (creative_assets-templates.sketch, "Header - 3840x1646"): 1646 x 661, centred, at
 * x 1097-2743, y 493-1154. That holds the one idea (asset-best-practices: "Focus on a single, clear
 * idea", "Design with a first-time visitor in mind"): the lockup and the site's own hero line.
 * Outside it, two real captures from app-store-shots.mjs on the cream ground and the mark's circles;
 * they show on wider crops (iPad, Mac) and may be cut away on a phone, which costs nothing.
 *
 * No price, URL, copyright symbol or other platform anywhere, per the same page. SAFE_AREA=1 draws
 * the safe area on top, for checking only -- never upload that version.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [IN, OUT] = process.argv.slice(2);
if (!IN || !OUT) throw new Error('usage: node tools/app-store-header.mjs <shotsDir> <outDir>');
const [W, H] = [3840, 1646];
const SAFE = { x: 1097, y: 493, w: 1646, h: 661 };
const png = (f) => `data:image/png;base64,${readFileSync(join(IN, f)).toString('base64')}`;
const lockup = `data:image/svg+xml;base64,${readFileSync(
  new URL('../../frontend/src/assets/huddle-lockup-horizontal-onlight.svg', import.meta.url),
).toString('base64')}`;

// A phone on each side, centred in the space between the safe area and the canvas edge, bleeding
// off the bottom. Behind each, two of the mark's circles: the four together are the mark.
const PHONE_H = 1520;
const PHONE_W = Math.round((PHONE_H * 1320) / 2868);
const sideCentre = SAFE.x / 2;
const phones = [
  { src: png('iphone-01-log-mid-workout.png'), left: sideCentre - PHONE_W / 2, circles: [['#E8734A', 0.52, 0.30, 560], ['#F2EDE1', 0.30, 0.95, 380]] },
  { src: png('iphone-03-progress-chart.png'), left: W - sideCentre - PHONE_W / 2, circles: [['#F2A65A', 0.50, 0.28, 500], ['#B5542D', 0.72, 0.92, 340]] },
];
const circles = phones.flatMap((p) => p.circles.map(([c, fx, fy, r]) => {
  const cx = p.left + fx * PHONE_W;
  const cy = fy * H;
  return `<i style="left:${cx - r}px;top:${cy - r}px;width:${2 * r}px;height:${2 * r}px;background:${c}"></i>`;
})).join('');

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@700&display=block">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: 'Barlow', sans-serif;
         background: linear-gradient(165deg, #fbf8f3 0%, #f4ebe0 100%); }
  i { position: absolute; border-radius: 50%; opacity: 0.08; }
  .phone { position: absolute; top: ${H - PHONE_H + 120}px; height: ${PHONE_H}px; border-radius: 64px;
           box-shadow: 0 40px 100px rgba(90, 50, 20, 0.22), 0 0 0 1px rgba(62, 58, 55, 0.08); }
  .safe { position: absolute; left: ${SAFE.x}px; top: ${SAFE.y}px; width: ${SAFE.w}px; height: ${SAFE.h}px;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 56px; text-align: center; }
  .safe img { height: 150px; }
  h1 { color: #3e3a37; font-size: 116px; font-weight: 700; line-height: 1.04; letter-spacing: -0.015em; }
  .debug { position: absolute; left: ${SAFE.x}px; top: ${SAFE.y}px; width: ${SAFE.w}px; height: ${SAFE.h}px;
           outline: 6px dashed #d0021b; display: ${process.env.SAFE_AREA === '1' ? 'block' : 'none'}; }
</style>
${circles}
${phones.map((p) => `<img class="phone" style="left:${p.left}px" src="${p.src}">`).join('')}
<div class="safe"><img src="${lockup}" alt=""><h1>One screen,<br>the whole family’s workout</h1></div>
<div class="debug"></div>`);
await page.evaluate(() => document.fonts.ready);
// The type must fit the safe area; fail loudly rather than ship a clipped headline.
const fits = await page.evaluate(({ x, y, w, h }) => [...document.querySelectorAll('.safe > *')].every((el) => {
  const r = el.getBoundingClientRect();
  return r.left >= x && r.right <= x + w && r.top >= y && r.bottom <= y + h;
}), SAFE);
if (!fits) throw new Error('header content overflows the art safe area');
const name = process.env.SAFE_AREA === '1' ? 'header-21x9-SAFE-AREA-CHECK.png' : 'header-21x9.png';
await page.screenshot({ path: join(OUT, name) });
console.log(name);
await browser.close();
