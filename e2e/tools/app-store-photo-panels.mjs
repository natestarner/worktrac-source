/* App Store screenshots, photo-led design: a licensed family photo opens the set, then real
 * captures of the app inside Apple's own iPhone frame, on a warm charcoal ground.
 *
 *   HERO_PHOTO=<jpg> BEZEL=<png> node tools/app-store-photo-panels.mjs <shotsDir> <outDir>
 *
 *   shotsDir    the RAW captures from tools/app-store-shots.mjs (iphone-01-log-mid-workout.png ...)
 *   HERO_PHOTO  the licensed Adobe Stock photo #509656835 (father and son with dumbbells)
 *   BEZEL       Apple's "iPhone 18 Pro Max - Black - Portrait.png" (Bezel-iPhone-18.dmg, from
 *               developer.apple.com/design/resources, Product Bezels)
 *   DEVICES     iphone63,iphone (default both)
 *
 * Neither the photo nor the bezel is in this repo, and neither may be: the repo is public, and
 * committing them would redistribute a licensed stock photo and Apple's artwork. Both are read
 * from paths outside it (docs/app-store-submission.md says where they live).
 *
 * UPLOAD THE iphone63 FILES. App Store Connect's required iPhone slot is the 6.3" one (1206 x 2622);
 * Apple shows it on every iPhone. The 1320 x 2868 set is the optional 6.9" slot.
 *
 * The seven panels are drawn side by side on ONE canvas and sliced, because the photo is meant to
 * run on behind panel 2: the father and son sit wholly inside panel 1, and the gym carries on under
 * panel 2's phone, so the first two read as one strip in search results. Both sizes come from the
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
 *  - The lifted switcher stays the phone's width, with "+ Add person" cut off at its own right
 *    edge: it says "and more people" without the strip breaking out of the panel.
 *  - Apple's frame is used unmodified (Apple's marketing guidelines); only a drop shadow is added.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [IN, OUT] = process.argv.slice(2);
const { HERO_PHOTO, BEZEL } = process.env;
if (!IN || !OUT || !HERO_PHOTO || !BEZEL) {
  throw new Error('usage: HERO_PHOTO=<jpg> BEZEL=<png> node tools/app-store-photo-panels.mjs <shotsDir> <outDir>');
}
const url = (p) => pathToFileURL(resolve(p)).href;

// Apple's 1470 x 3000 frame has its screen opening at (75, 66), exactly 1320 x 2868: the 6.9" capture
// drops in at 1:1. A different frame file would need these re-measured.
const png = readFileSync(BEZEL);
if (png.readUInt32BE(16) !== 1470 || png.readUInt32BE(20) !== 3000) {
  throw new Error(`BEZEL must be Apple's 1470 x 3000 iPhone 18 Pro Max portrait PNG (got ${png.readUInt32BE(16)} x ${png.readUInt32BE(20)})`);
}

// Store order. `shot` is the raw capture's scene name from app-store-shots.mjs.
const PANELS = [
  { scene: '01-every-set', hero: true },
  { scene: '02-log-for-anyone', shot: '01-log-mid-workout', switcher: true,
    title: 'Log a set for<br><em>anyone</em> in the house', sub: 'Switch people with one tap.' },
  { scene: '03-progress-chart', shot: '03-progress-chart',
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
for (const p of PANELS.filter((p) => p.shot)) {
  const f = join(IN, `iphone-${p.shot}.png`);
  if (!existsSync(f)) throw new Error(`missing raw capture ${f} (run tools/app-store-shots.mjs first)`);
  p.src = url(f);
}

const lockup = new URL('../../frontend/src/assets/huddle-lockup-horizontal-ondark.svg', import.meta.url).href;
const photo = url(HERO_PHOTO);
const bezel = url(BEZEL);
const logShot = PANELS[1].src;

const statusIcons = `<span class="sb-icons">
  <svg viewBox="0 0 34 22" width="70" height="44" aria-hidden="true"><rect x="0" y="14" width="6" height="8" rx="1.5"/><rect x="9.3" y="10" width="6" height="12" rx="1.5"/><rect x="18.6" y="5" width="6" height="17" rx="1.5"/><rect x="27.9" y="0" width="6" height="22" rx="1.5"/></svg>
  <svg viewBox="0 0 30 22" width="62" height="44" aria-hidden="true"><path d="M15 4.5c4.2 0 8 1.6 10.9 4.2l2.4-2.5C24.8 2.9 20.1 1 15 1S5.2 2.9 1.7 6.2l2.4 2.5C7 6.1 10.8 4.5 15 4.5z"/><path d="M15 11c2.4 0 4.6.9 6.3 2.4l2.4-2.5C21.4 8.8 18.3 7.6 15 7.6s-6.4 1.2-8.7 3.3l2.4 2.5c1.7-1.5 3.9-2.4 6.3-2.4z"/><path d="M15 17.4c.9 0 1.7.3 2.3.9L15 21l-2.3-2.7c.6-.6 1.4-.9 2.3-.9z"/></svg>
  <span class="batt"></span></span>`;

const phone = (p) => `<div class="aphone"><div class="scr">
    <div class="sbar" style="background:${p.bar}"><span>9:41</span>${statusIcons}</div><img class="shot" src="${p.src}">
  </div><img class="frame" src="${bezel}" alt=""></div>`;

const panelHtml = (p, i) => p.hero
  ? `<section class="panel hero" style="left:${i * 1320}px">
      <img class="lockup" src="${lockup}" alt="Huddle">
      <h1>Every set.<br>Every rep.<br><em>Everyone.</em></h1>
      <p class="sub">Celebrate your PRs together.</p></section>`
  : `<section class="panel${p.switcher ? ' switcher' : ''}${i > 1 ? ' glow' : ''}" style="left:${i * 1320}px">
      <h2>${p.title}</h2><p class="sub">${p.sub}</p>
      ${p.switcher ? '<div class="callout"><div class="crop"></div></div>' : ''}${phone(p)}</section>`;

const html = (H) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;600;700;800&display=block">
<style>
  :root { --ink: #f7f5f1; --muted: rgba(247, 245, 241, 0.78); --accent: #f2a65a; --dark: #1c1b19; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${PANELS.length * 1320}px; height: ${H}px; overflow: hidden; }
  body { position: relative; font-family: 'Barlow', sans-serif;
    background: radial-gradient(1700px 1300px at 1500px 2200px, rgba(212, 103, 62, 0.26), transparent 70%),
                linear-gradient(180deg, #3d3a37 0%, #2f2d2b 45%, #242220 100%); }

  /* The hero photo. The pair sits inside panel 1 (centred, with the far end of the dad's raised
     dumbbell cut by the panel edge -- never his hand); the gym runs on under panel 2's phone. */
  .photo, .photo-ext { position: absolute; left: -555px; width: 2380px; background-image: url('${photo}'); background-repeat: no-repeat;
    -webkit-mask-composite: source-in; mask-composite: intersect; }
  .photo { bottom: 0; height: 1586px; background-size: 2380px auto; background-position: 0 100%;
    -webkit-mask-image:
      linear-gradient(180deg, transparent 0px, rgba(0,0,0,.08) 40px, rgba(0,0,0,.25) 80px, rgba(0,0,0,.5) 120px, rgba(0,0,0,.75) 160px, rgba(0,0,0,.92) 200px, #000 240px),
      linear-gradient(90deg, #000 79%, rgba(0,0,0,.8) 82%, rgba(0,0,0,.5) 87%, rgba(0,0,0,.22) 92%, rgba(0,0,0,.06) 96%, transparent 100%); }
  /* The photo has almost no ceiling above their heads, so its top rows are stretched and blurred
     upward: the image dissolves into the page over ~800px instead of stopping short. */
  .photo-ext { bottom: ${1586 - 240}px; height: 1040px; background-size: 2380px 9516px; background-position: 0 0; filter: blur(28px);
    -webkit-mask-image:
      linear-gradient(180deg, transparent 0%, rgba(0,0,0,.06) 20%, rgba(0,0,0,.2) 40%, rgba(0,0,0,.45) 60%, rgba(0,0,0,.75) 78%, #000 92%),
      linear-gradient(90deg, #000 79%, rgba(0,0,0,.8) 82%, rgba(0,0,0,.5) 87%, rgba(0,0,0,.22) 92%, rgba(0,0,0,.06) 96%, transparent 100%); }
  /* Lifts the photo's near-black ceiling to the ground's charcoal; clears before their heads. */
  .photo-tint { position: absolute; left: 0; width: 1900px; bottom: ${1586 - 300}px; height: 1100px;
    -webkit-mask-image: linear-gradient(90deg, #000 70%, transparent 100%);
    background: linear-gradient(180deg, rgba(47,45,43,0) 0%, rgba(47,45,43,.35) 14%, rgba(47,45,43,.75) 28%, rgba(47,45,43,.92) 42%,
      rgba(47,45,43,.85) 62%, rgba(47,45,43,.55) 76%, rgba(47,45,43,.22) 87%, rgba(47,45,43,0) 96%); }

  .panel { position: absolute; top: 0; width: 1320px; height: ${H}px; overflow: hidden;
    display: flex; flex-direction: column; align-items: center; padding: 200px 110px 0; text-align: center; }
  .panel.glow { background: radial-gradient(1400px 1100px at 660px 600px, rgba(242, 166, 90, 0.10), transparent 70%); }
  .panel.hero { padding-top: 330px; overflow: visible; }   /* the space above the photo is held for ratings */
  .lockup { height: 196px; margin-bottom: 70px; }
  h1, h2 { color: var(--ink); font-weight: 800; letter-spacing: -2px; line-height: 1; }
  h1 { font-size: 146px; }
  h2 { font-size: 124px; }
  em { font-style: normal; color: var(--accent); }
  .sub { margin-top: 48px; font-size: 64px; font-weight: 500; line-height: 1.28; color: var(--muted); }

  /* Apple's frame, unmodified; the capture sits behind its 1320 x 2868 opening. iOS draws a 162px
     status bar the web capture doesn't have, so the capture starts below it. */
  .aphone { position: absolute; left: 50%; top: 780px; width: 1470px; height: 3000px;
    transform: translateX(-50%) scale(0.8027); transform-origin: top center;
    filter: drop-shadow(0 50px 70px rgba(0, 0, 0, 0.45)); }
  .scr { position: absolute; left: 75px; top: 66px; width: 1320px; height: 2868px; background: #fff; overflow: hidden; border-radius: 190px; }
  .frame { position: absolute; left: 0; top: 0; width: 1470px; height: 3000px; }
  .sbar { height: 162px; background: #fff; display: flex; justify-content: space-between; align-items: center;
    padding: 0 96px 0 150px; font: 600 54px 'Barlow', sans-serif; color: var(--dark); }
  .sb-icons { display: flex; align-items: center; gap: 16px; }
  .sb-icons svg { fill: var(--dark); }
  .batt { width: 78px; height: 38px; border: 4px solid var(--dark); border-radius: 11px; position: relative; }
  .batt::before { content: ''; position: absolute; inset: 4px; right: 14px; background: var(--dark); border-radius: 5px; }
  .shot { display: block; width: 1320px; height: 2706px; object-fit: cover; object-position: top; }

  /* Panel 2 only: the person switcher lifted over its own row, the rest of the screen dimmed ~20%.
     The crop coordinates are the switcher row in the 6.9" log capture: re-check them after any
     change to the app's header or person pills. */
  .switcher .scr::after { content: ''; position: absolute; inset: 0; background: rgba(24, 22, 20, 0.2); }
  .callout { position: absolute; left: 50%; transform: translateX(-50%); top: 1118px; z-index: 5;
    padding: 16px 0 16px 20px; border-radius: 46px; overflow: hidden; background: #fff;
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.42), 0 8px 18px rgba(0, 0, 0, 0.25); }
  .crop { width: 1030px; height: 154px; background: url('${logShot}') -41px -206px / 1193px auto no-repeat; }
</style>
<div class="photo-ext"></div><div class="photo"></div><div class="photo-tint"></div>
${PANELS.map(panelHtml).join('\n')}`;

// Each size renders the same 1320-wide layout. The 6.3" canvas is 2870 tall so that 1206/1320
// scale lands on exactly 1206 x 2622.
const SIZES = { iphone: { H: 2868, scale: 1 }, iphone63: { H: 2870, scale: 1206 / 1320 } };
const EXPECT = { iphone: [1320, 2868], iphone63: [1206, 2622] };
const devices = (process.env.DEVICES || 'iphone63,iphone').split(',');

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// The status bar takes the colour of the top of its own capture: white over an ordinary screen,
// grey over one a dialog's scrim has dimmed (the PR celebration) -- a white bar there looks pasted
// on. Sampled from a data: URL, since a file:// image taints the canvas.
{
  const probe = await browser.newPage();
  for (const p of PANELS.filter((p) => p.shot)) {
    const data = `data:image/png;base64,${readFileSync(join(IN, `iphone-${p.shot}.png`)).toString('base64')}`;
    p.bar = await probe.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
      const g = c.getContext('2d');
      g.drawImage(img, 20, 4, 1, 1, 0, 0, 1, 1);
      const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${gr}, ${b})`;
    }, data);
  }
  await probe.close();
}

for (const device of devices) {
  const { H, scale } = SIZES[device] ?? (() => { throw new Error(`unknown device ${device}`); })();
  const page = await browser.newPage({ viewport: { width: PANELS.length * 1320, height: H }, deviceScaleFactor: scale });
  const file = join(tmpdir(), `huddle-photo-panels-${process.pid}.html`); // file:// so the page may load file:// images
  writeFileSync(file, html(H));
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.waitForTimeout(300); // let the masked, blurred photo layers paint
  for (const [i, p] of PANELS.entries()) {
    const out = join(OUT, `${device}-${p.scene}.png`);
    await page.screenshot({ path: out, clip: { x: i * 1320, y: 0, width: 1320, height: H } });
    const b = readFileSync(out);
    const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (w !== EXPECT[device][0] || h !== EXPECT[device][1]) throw new Error(`${out} is ${w} x ${h}, expected ${EXPECT[device].join(' x ')}`);
    if (b[25] !== 2) throw new Error(`${out} is not plain RGB (PNG colour type ${b[25]}); Apple rejects an alpha channel`);
    console.log(`${device}-${p.scene}.png`);
  }
  await page.close();
}
await browser.close();
