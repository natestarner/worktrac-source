/* App Store screenshots, photo-led design: a licensed family photo opens the set, then real
 * captures of the app inside Apple's own device frame, on a warm charcoal ground.
 *
 *   HERO_PHOTO=<jpg> PHONE_BEZEL=<png> TABLET_BEZEL=<png> \
 *     node tools/app-store-photo-panels.mjs <shotsDir> <outDir>
 *
 *   shotsDir      the RAW captures from tools/app-store-shots.mjs (iphone-01-log-mid-workout.png ...)
 *   HERO_PHOTO    the licensed Adobe Stock photo #509656835 (father and son with dumbbells)
 *   PHONE_BEZEL   Apple's "iPhone 18 Pro Max - Black - Portrait.png"      (Bezel-iPhone-18.dmg)
 *   TABLET_BEZEL  Apple's "iPad Pro (M5) 13" - Space Black - Portrait.png" (Bezel-iPad-Pro-(M5).dmg)
 *                 both from developer.apple.com/design/resources, Product Bezels
 *   DEVICES       iphone63,iphone,ipad (default all three; a family whose bezel isn't given is skipped)
 *
 * Neither the photo nor a bezel is in this repo, and none may be: the repo is public, and
 * committing them would redistribute a licensed stock photo and Apple's artwork. They are read
 * from paths outside it (docs/app-store-submission.md says where they live, and what Apple's
 * license allows).
 *
 * UPLOAD iphone63-* AND ipad-*. App Store Connect's required iPhone slot is the 6.3" one
 * (1206 x 2622), shown on every iPhone; the 1320 x 2868 set is the optional 6.9" slot.
 *
 * Each family's panels are drawn side by side on ONE canvas and sliced, because the photo runs on
 * behind panel 2: the father and son sit wholly inside panel 1, and the gym carries on under panel
 * 2's device, so the first two read as one strip in search results. Both iPhone sizes come from the
 * same 1320-wide layout; the 6.3" set renders it at 1206/1320 scale (the two screens share a shape).
 *
 * Design decisions (Nate, 2026-11-19), so nobody "fixes" them back:
 *  - Warm charcoal ground. Espresso and mid-brown read too dark/heavy; orange hid the brand mark.
 *  - The photo in natural colour. A sepia grade washed it out.
 *  - Panel 1's headline is larger (the cover); every feature headline shares ONE size.
 *  - Panel 1 keeps open space above the photo: App Store ratings go there once there are some.
 *    Trust icons there looked cheap and were removed.
 *  - Only panel 2 gets an emphasis treatment (the person switcher, lifted, with the rest of the
 *    screen dimmed ~20%). Used on every panel it would stop meaning "this is the special thing".
 *  - On the iPhone the lifted switcher stays the phone's width, with "+ Add person" cut off at its
 *    own right edge: "and more people" without the strip breaking out. On the iPad the row is
 *    short enough that the whole button shows, as it does in the app.
 *  - Apple's frames are used unmodified (Apple's guidelines); only a drop shadow is added.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [IN, OUT] = process.argv.slice(2);
const { HERO_PHOTO, PHONE_BEZEL, TABLET_BEZEL } = process.env;
if (!IN || !OUT || !HERO_PHOTO || !(PHONE_BEZEL || TABLET_BEZEL)) {
  throw new Error('usage: HERO_PHOTO=<jpg> PHONE_BEZEL=<png> TABLET_BEZEL=<png> node tools/app-store-photo-panels.mjs <shotsDir> <outDir>');
}
const url = (p) => pathToFileURL(resolve(p)).href;

// Store order. `shot` is the raw capture's scene name from app-store-shots.mjs, per family: the
// iPad has no separate progress-chart capture (its Trends opens on the overview, which carries the
// same story), so panel 3 uses that there.
const PANELS = [
  { scene: '01-every-set', hero: true },
  { scene: '02-log-for-anyone', shot: '01-log-mid-workout', switcher: true,
    title: 'Log a set for<br><em>anyone</em> in the house', sub: 'Switch people with one tap.' },
  { scene: '03-progress-chart', shot: { phone: '03-progress-chart', tablet: '04-trends-overview' },
    title: 'Watch each other<br><em>make progress</em>', sub: 'Charts and personal bests<br>for every person.' },
  { scene: '04-pr-celebration', shot: '02-pr-celebration',
    title: 'Celebrate<br><em>every PR</em>', sub: 'Records spotted the moment<br>you lift them.' },
  { scene: '05-prs', shot: '05-prs',
    title: 'Every best,<br><em>in one place</em>', sub: 'Recomputed from<br>your actual sets.' },
  { scene: '06-no-signal', shot: '06-history',
    title: 'Works with<br><em>no signal</em>', sub: 'Sets save on your phone first,<br>then sync.' },
  { scene: '07-muscles', shot: '08-muscles',
    title: 'Every muscle,<br><em>counted</em>', sub: 'Sets per muscle,<br>shaded on the body.' },
];

// One layout per device family. `frame` is Apple's PNG and where its screen opening sits; the raw
// capture is exactly the opening's size, so it drops in at 1:1. A different frame file would need
// these re-measured (the tool checks the PNG's size and refuses a mismatch).
const FAMILIES = {
  phone: {
    prefix: 'iphone', bezel: PHONE_BEZEL, W: 1320, H: 2868,
    frame: { w: 1470, h: 3000, x: 75, y: 66, radius: 190 }, scale: 0.8027, top: 780,
    // iOS draws a status bar the web capture doesn't have, so the capture starts below it.
    sbar: { h: 162, font: 54, pad: '0 96px 0 150px', sig: [70, 44], wifi: [62, 44], batt: [78, 38, 4], gap: 16 },
    type: { pad: 200, heroPad: 330, lockup: 196, lockupGap: 70, h1: 146, h2: 124, sub: 64, subGap: 48 },
    photo: { left: -555, w: 2380 },
    // The switcher row in the 6.9" log capture, at ~0.9x (a touch larger than in the phone). Re-check
    // after any change to the app's header or person pills.
    callout: { centred: true, top: 1118, crop: [1030, 154], bg: [1193, -41, -206], pad: '16px 0 16px 20px', radius: 46 },
  },
  tablet: {
    prefix: 'ipad', bezel: TABLET_BEZEL, W: 2064, H: 2752,
    frame: { w: 2300, h: 3000, x: 118, y: 124, radius: 60 }, scale: 0.739, top: 760,
    sbar: { h: 48, font: 28, pad: '0 44px 0 52px', sig: [36, 23], wifi: [32, 23], batt: [42, 20, 2.5], gap: 10 },
    type: { pad: 190, heroPad: 260, lockup: 210, lockupGap: 60, h1: 160, h2: 150, sub: 74, subGap: 44 },
    photo: { left: -305, w: 2500 },
    // The iPad's switcher row (log capture x 30-960, y 150-262) at 0.89x, centred over the real row.
    callout: { left: 262, top: 975, crop: [828, 100], bg: [1837, -27, -134], pad: '14px 18px', radius: 40 },
  },
};

const statusIcons = (s) => `<span class="sb-icons">
  <svg viewBox="0 0 34 22" width="${s.sig[0]}" height="${s.sig[1]}" aria-hidden="true"><rect x="0" y="14" width="6" height="8" rx="1.5"/><rect x="9.3" y="10" width="6" height="12" rx="1.5"/><rect x="18.6" y="5" width="6" height="17" rx="1.5"/><rect x="27.9" y="0" width="6" height="22" rx="1.5"/></svg>
  <svg viewBox="0 0 30 22" width="${s.wifi[0]}" height="${s.wifi[1]}" aria-hidden="true"><path d="M15 4.5c4.2 0 8 1.6 10.9 4.2l2.4-2.5C24.8 2.9 20.1 1 15 1S5.2 2.9 1.7 6.2l2.4 2.5C7 6.1 10.8 4.5 15 4.5z"/><path d="M15 11c2.4 0 4.6.9 6.3 2.4l2.4-2.5C21.4 8.8 18.3 7.6 15 7.6s-6.4 1.2-8.7 3.3l2.4 2.5c1.7-1.5 3.9-2.4 6.3-2.4z"/><path d="M15 17.4c.9 0 1.7.3 2.3.9L15 21l-2.3-2.7c.6-.6 1.4-.9 2.3-.9z"/></svg>
  <span class="batt"></span></span>`;

const lockup = new URL('../../frontend/src/assets/huddle-lockup-horizontal-ondark.svg', import.meta.url).href;
const photo = url(HERO_PHOTO);

const html = (L, H, shots, bars) => {
  const { W, frame: F, sbar: S, type: T, photo: P, callout: C } = L;
  const N = PANELS.length;
  const pH = Math.round((P.w * 3587) / 5380); // the photo's height at this width (5380 x 3587 original)
  const fadeX = (100 * (W - P.left)) / P.w; // % of the photo's width where panel 1 ends
  const hFade = `linear-gradient(90deg, #000 ${fadeX}%, rgba(0,0,0,.8) ${fadeX + 3}%, rgba(0,0,0,.5) ${fadeX + 8}%, rgba(0,0,0,.22) ${Math.min(fadeX + 13, 98)}%, rgba(0,0,0,.06) ${Math.min(fadeX + 17, 99)}%, transparent 100%)`;
  const device = (i) => `<div class="dev"><div class="scr">
      <div class="sbar" style="background:${bars[i]}"><span>9:41</span>${statusIcons(S)}</div><img class="shot" src="${shots[i]}">
    </div><img class="frame" src="${url(L.bezel)}" alt=""></div>`;
  const panel = (p, i) => p.hero
    ? `<section class="panel hero" style="left:${i * W}px">
        <img class="lockup" src="${lockup}" alt="Huddle">
        <h1>Every set.<br>Every rep.<br><em>Everyone.</em></h1>
        <p class="sub">Celebrate your PRs together.</p></section>`
    : `<section class="panel${p.switcher ? ' switcher' : ''}${i > 1 ? ' glow' : ''}" style="left:${i * W}px">
        <h2>${p.title}</h2><p class="sub">${p.sub}</p>
        ${p.switcher ? '<div class="callout"><div class="crop"></div></div>' : ''}${device(i)}</section>`;
  return `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;600;700;800&display=block">
<style>
  :root { --ink: #f7f5f1; --muted: rgba(247, 245, 241, 0.78); --accent: #f2a65a; --dark: #1c1b19; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${N * W}px; height: ${H}px; overflow: hidden; }
  body { position: relative; font-family: 'Barlow', sans-serif;
    background: radial-gradient(${1.29 * W}px ${0.45 * H}px at ${1.14 * W}px ${0.77 * H}px, rgba(212, 103, 62, 0.26), transparent 70%),
                linear-gradient(180deg, #3d3a37 0%, #2f2d2b 45%, #242220 100%); }

  /* The hero photo. The pair sits inside panel 1 (centred; the far end of the dad's raised dumbbell
     may be cut by the panel edge, never his hand); the gym runs on behind panel 2's device. */
  .photo, .photo-ext { position: absolute; left: ${P.left}px; width: ${P.w}px; background-image: url('${photo}'); background-repeat: no-repeat;
    -webkit-mask-composite: source-in; mask-composite: intersect; }
  .photo { bottom: 0; height: ${pH}px; background-size: ${P.w}px auto; background-position: 0 100%;
    -webkit-mask-image:
      linear-gradient(180deg, transparent 0px, rgba(0,0,0,.08) 40px, rgba(0,0,0,.25) 80px, rgba(0,0,0,.5) 120px, rgba(0,0,0,.75) 160px, rgba(0,0,0,.92) 200px, #000 240px),
      ${hFade}; }
  /* The photo has almost no ceiling above their heads, so its top rows are stretched and blurred
     upward: the image dissolves into the page over ~800px instead of stopping short. */
  .photo-ext { bottom: ${pH - 240}px; height: 1040px; background-size: ${P.w}px ${6 * pH}px; background-position: 0 0; filter: blur(28px);
    -webkit-mask-image:
      linear-gradient(180deg, transparent 0%, rgba(0,0,0,.06) 20%, rgba(0,0,0,.2) 40%, rgba(0,0,0,.45) 60%, rgba(0,0,0,.75) 78%, #000 92%),
      ${hFade}; }
  /* Lifts the photo's near-black ceiling to the ground's charcoal; clears before their heads. */
  .photo-tint { position: absolute; left: 0; width: ${W + 580}px; bottom: ${pH - 300}px; height: 1100px;
    -webkit-mask-image: linear-gradient(90deg, #000 70%, transparent 100%);
    background: linear-gradient(180deg, rgba(47,45,43,0) 0%, rgba(47,45,43,.35) 14%, rgba(47,45,43,.75) 28%, rgba(47,45,43,.92) 42%,
      rgba(47,45,43,.85) 62%, rgba(47,45,43,.55) 76%, rgba(47,45,43,.22) 87%, rgba(47,45,43,0) 96%); }

  .panel { position: absolute; top: 0; width: ${W}px; height: ${H}px; overflow: hidden;
    display: flex; flex-direction: column; align-items: center; padding: ${T.pad}px 110px 0; text-align: center; }
  .panel.glow { background: radial-gradient(${1.06 * W}px ${0.38 * H}px at 50% ${0.21 * H}px, rgba(242, 166, 90, 0.10), transparent 70%); }
  .panel.hero { padding-top: ${T.heroPad}px; overflow: visible; }   /* the space above the photo is held for ratings */
  .lockup { height: ${T.lockup}px; margin-bottom: ${T.lockupGap}px; }
  h1, h2 { color: var(--ink); font-weight: 800; letter-spacing: -2px; line-height: 1; }
  h1 { font-size: ${T.h1}px; }
  h2 { font-size: ${T.h2}px; }
  em { font-style: normal; color: var(--accent); }
  .sub { margin-top: ${T.subGap}px; font-size: ${T.sub}px; font-weight: 500; line-height: 1.28; color: var(--muted); }

  /* Apple's frame, unmodified; the capture sits behind its screen opening. */
  .dev { position: absolute; left: 50%; top: ${L.top}px; width: ${F.w}px; height: ${F.h}px;
    transform: translateX(-50%) scale(${L.scale}); transform-origin: top center;
    filter: drop-shadow(0 50px 70px rgba(0, 0, 0, 0.45)); }
  .scr { position: absolute; left: ${F.x}px; top: ${F.y}px; width: ${W}px; height: ${L.H}px; background: #fff; overflow: hidden; border-radius: ${F.radius}px; }
  .frame { position: absolute; left: 0; top: 0; width: ${F.w}px; height: ${F.h}px; }
  .sbar { height: ${S.h}px; display: flex; justify-content: space-between; align-items: center;
    padding: ${S.pad}; font: 600 ${S.font}px 'Barlow', sans-serif; color: var(--dark); }
  .sb-icons { display: flex; align-items: center; gap: ${S.gap}px; }
  .sb-icons svg { fill: var(--dark); }
  .batt { width: ${S.batt[0]}px; height: ${S.batt[1]}px; border: ${S.batt[2]}px solid var(--dark); border-radius: ${S.batt[1] * 0.29}px; position: relative; }
  .batt::before { content: ''; position: absolute; inset: ${S.batt[2]}px; right: ${S.batt[0] * 0.18}px; background: var(--dark); border-radius: ${S.batt[1] * 0.13}px; }
  .shot { display: block; width: ${W}px; height: ${L.H - S.h}px; object-fit: cover; object-position: top; }

  /* Panel 2 only: the person switcher lifted over its own row, the rest of the screen dimmed ~20%. */
  .switcher .scr::after { content: ''; position: absolute; inset: 0; background: rgba(24, 22, 20, 0.2); }
  .callout { position: absolute; ${C.centred ? 'left: 50%; transform: translateX(-50%);' : `left: ${C.left}px;`} top: ${C.top}px; z-index: 5;
    padding: ${C.pad}; border-radius: ${C.radius}px; overflow: hidden; background: #fff;
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.42), 0 8px 18px rgba(0, 0, 0, 0.25); }
  .crop { width: ${C.crop[0]}px; height: ${C.crop[1]}px; background: url('${shots[1]}') ${C.bg[1]}px ${C.bg[2]}px / ${C.bg[0]}px auto no-repeat; }
</style>
<div class="photo-ext"></div><div class="photo"></div><div class="photo-tint"></div>
${PANELS.map(panel).join('\n')}`;
};

// Output sizes. The 6.3" canvas is 2870 tall so that 1206/1320 scale lands on exactly 1206 x 2622.
const DEVICES = {
  iphone63: { family: 'phone', H: 2870, scale: 1206 / 1320, expect: [1206, 2622] },
  iphone: { family: 'phone', H: 2868, scale: 1, expect: [1320, 2868] },
  ipad: { family: 'tablet', H: 2752, scale: 1, expect: [2064, 2752] },
};
const wanted = (process.env.DEVICES || 'iphone63,iphone,ipad').split(',')
  .filter((d) => {
    if (!DEVICES[d]) throw new Error(`unknown device ${d}`);
    return FAMILIES[DEVICES[d].family].bezel; // a family whose bezel wasn't given is skipped
  });

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// Per family: the raw captures, Apple's frame checked, and each status bar's colour, taken from the
// top of its own capture -- white over an ordinary screen, grey over one a dialog's scrim has dimmed
// (the PR celebration). Sampled from a data: URL, since a file:// image taints the canvas.
const prepared = {};
const probe = await browser.newPage();
for (const family of new Set(wanted.map((d) => DEVICES[d].family))) {
  const L = FAMILIES[family];
  const png = readFileSync(L.bezel);
  if (png.readUInt32BE(16) !== L.frame.w || png.readUInt32BE(20) !== L.frame.h) {
    throw new Error(`${family} bezel must be ${L.frame.w} x ${L.frame.h} (got ${png.readUInt32BE(16)} x ${png.readUInt32BE(20)}): Apple's portrait PNG named at the top of this file`);
  }
  const shots = [];
  const bars = [];
  for (const p of PANELS) {
    if (p.hero) { shots.push(null); bars.push(null); continue; }
    const name = typeof p.shot === 'string' ? p.shot : p.shot[family];
    const f = join(IN, `${L.prefix}-${name}.png`);
    if (!existsSync(f)) throw new Error(`missing raw capture ${f} (run tools/app-store-shots.mjs first)`);
    shots.push(url(f));
    bars.push(await probe.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
      const g = c.getContext('2d');
      g.drawImage(img, 20, 4, 1, 1, 0, 0, 1, 1);
      const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${gr}, ${b})`;
    }, `data:image/png;base64,${readFileSync(f).toString('base64')}`));
  }
  prepared[family] = { shots, bars };
}
await probe.close();

for (const d of wanted) {
  const { family, H, scale, expect } = DEVICES[d];
  const L = FAMILIES[family];
  const page = await browser.newPage({ viewport: { width: PANELS.length * L.W, height: H }, deviceScaleFactor: scale });
  const file = join(tmpdir(), `huddle-photo-panels-${process.pid}-${d}.html`); // file:// so the page may load file:// images
  writeFileSync(file, html(L, H, prepared[family].shots, prepared[family].bars));
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.waitForTimeout(300); // let the masked, blurred photo layers paint
  for (const [i, p] of PANELS.entries()) {
    const out = join(OUT, `${d}-${p.scene}.png`);
    await page.screenshot({ path: out, clip: { x: i * L.W, y: 0, width: L.W, height: H } });
    const b = readFileSync(out);
    const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (w !== expect[0] || h !== expect[1]) throw new Error(`${out} is ${w} x ${h}, expected ${expect.join(' x ')}`);
    if (b[25] !== 2) throw new Error(`${out} is not plain RGB (PNG colour type ${b[25]}); Apple rejects an alpha channel`);
    console.log(`${d}-${p.scene}.png`);
  }
  await page.close();
}
await browser.close();
