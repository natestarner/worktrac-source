/* Captioned App Store screenshots: each capture from tools/app-store-shots.mjs, unaltered, under the
 * Huddle lockup and a short headline, at the same pixel size App Store Connect asks for.
 *
 *   THEME=cream node tools/app-store-frames.mjs <shotsDir> <outDir> [scene,scene...]
 *
 *   THEME   cream (default) | night | sunrise -- see THEMES below
 *
 * Only the first two or three screenshots show in search results, and people skim them without
 * reading the UI -- the headline is what carries the pitch. The screenshot inside is the real
 * capture, scaled to fit: nothing drawn over it, no device frame, no status bar.
 *
 * The lockup is the brand kit's own file (frontend/src/assets/huddle-lockup-horizontal-*.svg), on
 * the ground it was drawn for -- onlight carries the cream circle's hairline, ondark doesn't
 * (docs/brand/README.md). The background circles echo the mark's four, in its fixed colours.
 *
 * The copy mirrors the marketing site's own section titles (marketing/index.html), so the store
 * listing and the site make the same claims and no claim the site doesn't.
 */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [IN, OUT, ONLY] = process.argv.slice(2);
if (!IN || !OUT) throw new Error('usage: node tools/app-store-frames.mjs <shotsDir> <outDir> [scenes]');

const CAPTIONS = {
  '01-log-mid-workout': ['Log a set in two taps', 'Last time and your best, right on screen'],
  '02-pr-celebration': ['Celebrate every PR', 'Records spotted the moment you lift them'],
  '03-progress-chart': ['Watch it add up', 'Every lift charted, week after week'],
  '04-trends-overview': ['See the work pay off', 'Streaks, volume and every training day'],
  '05-prs': ['Every best, in one place', 'Recomputed from your actual sets'],
  '06-history': ['Works with no signal', 'Sets save on your phone first, then sync'],
  '07-start-workout': ['The whole family', 'Everyone gets their own log'],
};
// Keep every title to one line at 112px (about 24 characters): a two-line title shrinks its
// screenshot, and the set stops reading as one.

// Mark colours (fixed): orange #E8734A, amber #F2A65A, cream #F2EDE1, rust #B5542D.
const THEMES = {
  // Warm paper. Calm, and the app's own orange controls become the brightest thing on the page.
  cream: {
    ground: 'linear-gradient(165deg, #fbf8f3 0%, #f4ebe0 100%)',
    ink: '#3e3a37', sub: '#6e655e', lockup: 'onlight', circleOpacity: 0.07,
    shadow: '0 30px 80px rgba(90, 50, 20, 0.22), 0 0 0 1px rgba(62, 58, 55, 0.08)',
  },
  // The brand kit's dark surface, with an orange glow behind the screenshot.
  night: {
    ground: 'radial-gradient(ellipse 80% 55% at 50% 72%, rgba(232, 115, 74, 0.34), transparent 70%), linear-gradient(170deg, #241a15 0%, #14100e 60%)',
    ink: '#f2ede1', sub: 'rgba(242, 237, 225, 0.72)', lockup: 'ondark', circleOpacity: 0.22,
    shadow: '0 30px 90px rgba(0, 0, 0, 0.55)',
  },
  // The mark's own colours as a gradient, rust to amber: the orange, with depth.
  sunrise: {
    ground: 'linear-gradient(160deg, #b5542d 0%, #e8734a 55%, #f2a65a 100%)',
    ink: '#ffffff', sub: 'rgba(255, 255, 255, 0.9)', lockup: 'ondark', circleOpacity: 0.28,
    shadow: '0 30px 80px rgba(70, 25, 5, 0.38)',
  },
};
const theme = THEMES[process.env.THEME || 'cream'];
if (!theme) throw new Error(`THEME must be one of ${Object.keys(THEMES).join(', ')}`);
const lockup = `data:image/svg+xml;base64,${readFileSync(
  new URL(`../../frontend/src/assets/huddle-lockup-horizontal-${theme.lockup}.svg`, import.meta.url),
).toString('base64')}`;
const SIZES = { iphone: [1320, 2868], ipad: [2064, 2752] };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const file of readdirSync(IN).filter((f) => f.endsWith('.png')).sort()) {
  const [, device, scene] = file.match(/^(iphone|ipad)-(.+)\.png$/) ?? [];
  if (!CAPTIONS[scene] || (ONLY && !ONLY.split(',').some((s) => scene.startsWith(s)))) continue;
  const [W, H] = SIZES[device];
  const [title, sub] = CAPTIONS[scene];
  const u = W / 1320; // type and spacing scale with the canvas width
  // The mark's four circles as soft caps tucked into the corners, their outer edges OFF the canvas.
  // Each edge must reach the side of the canvas before the headline starts, so no arc or seam ever
  // crosses the words (Nate, 2026-10-27: arcs meeting under the writing read as chaotic). Measured
  // in canvas WIDTHS, from the top or bottom edge, so the curve clears the text on the squarer iPad
  // canvas too: [colour, x, y from that edge, radius].
  const circles = [
    ['#E8734A', 0.02, -0.18, 0.35, 'top'], ['#F2A65A', 0.98, -0.19, 0.33, 'top'],
    ['#F2EDE1', 0.04, 0.11, 0.34, 'bottom'], ['#B5542D', 0.96, 0.07, 0.3, 'bottom'],
  ].map(([c, fx, fy, fr, edge]) => {
    const r = fr * W;
    const cy = edge === 'top' ? fy * W : H - fy * W;
    return `<i style="left:${fx * W - r}px;top:${cy - r}px;width:${2 * r}px;height:${2 * r}px;background:${c}"></i>`;
  }).join('');
  const src = `data:image/png;base64,${readFileSync(join(IN, file)).toString('base64')}`;
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(`<!doctype html>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;700&display=block">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: 'Barlow', sans-serif;
         background: ${theme.ground}; display: flex; flex-direction: column; align-items: center; }
  i { position: absolute; border-radius: 50%; opacity: ${theme.circleOpacity}; }
  header { position: relative; padding: ${96 * u}px ${80 * u}px 0; text-align: center; }
  .lockup { height: ${124 * u}px; display: block; margin: 0 auto ${44 * u}px; }
  h1 { color: ${theme.ink}; font-size: ${112 * u}px; font-weight: 700; line-height: 1.05; letter-spacing: -0.015em; }
  p { color: ${theme.sub}; margin-top: ${26 * u}px; font-size: ${54 * u}px; font-weight: 500; line-height: 1.2; }
  .shot { position: relative; flex: 1; min-height: 0; display: flex; align-items: flex-end; padding: ${80 * u}px 0 ${110 * u}px; }
  .shot img { height: 100%; border-radius: ${56 * u}px; display: block; box-shadow: ${theme.shadow}; }
</style>
${circles}
<header><img class="lockup" src="${lockup}" alt=""><h1>${title}</h1><p>${sub}</p></header>
<div class="shot"><img src="${src}"></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, file) });
  console.log(file);
}
await browser.close();
