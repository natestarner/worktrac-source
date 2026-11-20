/* The App Store product page header (App Store Connect → version → Header and Search Results).
 *
 *   PHONE_BEZEL=<png> node tools/app-store-header.mjs <shotsDir> <outDir>
 *
 *   shotsDir     a raw/ folder from app-store-shots.mjs (uses iphone-01-log-mid-workout and
 *                iphone-03-progress-chart, the 6.9" captures)
 *   PHONE_BEZEL  Apple's "iPhone 18 Pro Max - Black - Portrait.png" (Bezel-iPhone-18.dmg), the same
 *                frame app-store-photo-panels.mjs uses. Not in this repo, and it may not be: the
 *                repo is public, and Apple licenses its frames for App Store mock-ups only
 *                (docs/app-store-submission.md).
 *
 * 21:9, 3840 x 1646 PNG, no transparency (creative-assets-specifications). Apple crops the header
 * differently per device, so everything that must be seen sits inside the ART SAFE AREA from Apple's
 * own template (creative_assets-templates.sketch, "Header - 3840x1646"): 1646 x 661, centred, at
 * x 1097-2743, y 493-1154. That holds the one idea (asset-best-practices: "Focus on a single, clear
 * idea", "Design with a first-time visitor in mind"): the lockup and a short headline.
 *
 * 2026-11-20: restyled to match the photo-led screenshot set (app-store-photo-panels.mjs) -- the same
 * warm charcoal ground and faint amber glow behind the type, the on-dark lockup, white type with "family's" in amber,
 * and the two flanking captures now inside Apple's iPhone frame. Nate chose this ("A") from three
 * side-by-side mock-ups. The other two put the licensed father/son photo in the header; rejected
 * because the same photo, same pose, then appears again in screenshot 1 one scroll below, and it
 * loses its impact the second time. Don't move the photo up here without also replacing panel 1.
 *
 * Carried over from the 2026-11-05 iPhone fit (Nate's "B2"): an iPhone shows the full height and
 * ~86% of the width (x ~269-3571), so type that only fills the safe area reads small there. The
 * headline is the short "The whole family's workout" (not the site's "One screen, ..."), which lets
 * it grow; the two lines plus the lockup use nearly the safe area's full height. The phones bleed off
 * the bottom and start low enough that the page's round back/share buttons don't cover their tops.
 *
 * No price, URL, copyright symbol or other platform anywhere, per the same page. SAFE_AREA=1 draws
 * the safe area (red) and the iPhone's visible width (blue) on top, for checking only -- never upload
 * that version.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [IN, OUT] = process.argv.slice(2);
const { PHONE_BEZEL } = process.env;
if (!IN || !OUT || !PHONE_BEZEL) {
  throw new Error('usage: PHONE_BEZEL=<png> node tools/app-store-header.mjs <shotsDir> <outDir>');
}
const [W, H] = [3840, 1646];
const SAFE = { x: 1097, y: 493, w: 1646, h: 661 };
const IPHONE_VISIBLE = { x: 269, w: 3302 };

const dataUrl = (file, type) => {
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  return `data:${type};base64,${readFileSync(file).toString('base64')}`;
};
const shot = (name) => dataUrl(join(IN, `iphone-${name}.png`), 'image/png');
const lockup = dataUrl(
  new URL('../../frontend/src/assets/huddle-lockup-horizontal-ondark.svg', import.meta.url),
  'image/svg+xml',
);

// Apple's frame and where its screen opening sits; the 6.9" capture is the opening's width, so it
// drops in at 1:1 below a drawn status bar. The tool refuses a frame of any other size.
const FRAME = { w: 1470, h: 3000, x: 75, y: 66, radius: 190, screenW: 1320, screenH: 2868, sbar: 162 };
const bezel = readFileSync(PHONE_BEZEL);
if (bezel.readUInt32BE(16) !== FRAME.w || bezel.readUInt32BE(20) !== FRAME.h) {
  throw new Error(`PHONE_BEZEL must be Apple's ${FRAME.w} x ${FRAME.h} portrait PNG`);
}
const bezelUrl = `data:image/png;base64,${bezel.toString('base64')}`;

// A phone each side, centred 640px in from the edge, bleeding off the bottom.
const PHONE = { scale: 0.52, top: 420, inset: 640 };
const phones = [
  { src: shot('01-log-mid-workout'), cx: PHONE.inset },
  { src: shot('03-progress-chart'), cx: W - PHONE.inset },
];
const device = (p) => `<div class="dev" style="left:${p.cx - FRAME.w / 2}px">
  <div class="scr"><div class="sbar"><span>9:41</span><span class="batt"></span></div><img class="shot" src="${p.src}"></div>
  <img class="frame" src="${bezelUrl}" alt=""></div>`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@600;800&display=block">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body { position: relative; font-family: 'Barlow', sans-serif;
    /* The panels' charcoal: a neutral ground with only a faint amber glow behind the type. A
       terracotta glow along the bottom (the first cut) turned it espresso-brown. The top starts
       lighter than the panels' (#55504b vs #3d3a37) for a stronger fade over this short canvas;
       Nate chose it from three steps (2026-11-20). Lighter than this read grey-brown. */
    background: radial-gradient(1900px 900px at 50% 48%, rgba(242, 166, 90, 0.10), transparent 70%),
                linear-gradient(180deg, #55504b 0%, #3b3835 50%, #242220 100%); }
  .safe { position: absolute; left: ${SAFE.x}px; top: ${SAFE.y}px; width: ${SAFE.w}px; height: ${SAFE.h}px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .safe img { height: 190px; margin-bottom: 44px; }
  h1 { color: #f7f5f1; font-size: 196px; font-weight: 800; letter-spacing: -2px; line-height: 1; }
  em { font-style: normal; color: #f2a65a; }
  /* Apple's frame, unmodified; the capture sits behind its screen opening. */
  .dev { position: absolute; top: ${PHONE.top}px; width: ${FRAME.w}px; height: ${FRAME.h}px;
    transform: scale(${PHONE.scale}); transform-origin: top center; filter: drop-shadow(0 50px 70px rgba(0, 0, 0, 0.45)); }
  .scr { position: absolute; left: ${FRAME.x}px; top: ${FRAME.y}px; width: ${FRAME.screenW}px; height: ${FRAME.screenH}px;
    background: #fff; overflow: hidden; border-radius: ${FRAME.radius}px; }
  .frame { position: absolute; left: 0; top: 0; width: ${FRAME.w}px; height: ${FRAME.h}px; }
  .sbar { height: ${FRAME.sbar}px; display: flex; justify-content: space-between; align-items: center;
    padding: 0 110px 0 150px; font: 600 54px 'Barlow', sans-serif; color: #1c1b19; background: #fff; }
  .batt { width: 78px; height: 38px; border: 4px solid #1c1b19; border-radius: 11px; }
  .shot { display: block; width: ${FRAME.screenW}px; height: ${FRAME.screenH - FRAME.sbar}px; object-fit: cover; object-position: top; }
  .debug { position: absolute; display: ${process.env.SAFE_AREA === '1' ? 'block' : 'none'}; }
</style>
${phones.map(device).join('\n')}
<div class="safe"><img src="${lockup}" alt="Huddle"><h1>The whole<br><em>family’s</em> workout</h1></div>
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
