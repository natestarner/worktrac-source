/* The marketing site's household clip: about nine seconds of the real app on a phone, recorded from
 * the reviewer demo household (the same people as every other image, tools/marketing-demo-shots.mjs).
 *
 *   cd e2e
 *   FRONTEND=https://app.huddle.fitness EMAIL=... PASSWORD=... ALLOW_WRITES=1 \
 *     node tools/marketing-demo-clip.mjs <workDir> ../marketing/assets/shots
 *
 *   ENCODE_ONLY=1 node tools/marketing-demo-clip.mjs <workDir> <outDir>
 *     re-encodes the frames a previous run left in <workDir>, without signing in or logging anything
 *
 * The story, one tap at a time: Alex's squat -> tap Sam (her numbers replace his) -> "+" weight and
 * "+" reps (the weight stepper moves 2.5 lb: 192.5 x 6 beats her best 190 x 6 on top weight AND
 * est. 1RM) -> Log set -> the New PR!
 * celebration -> Nice -> Trends, scrolled to her squat chart, where the set just logged is the new
 * high point -> tap that point.
 *
 * A soft ring marks every tap a beat before it lands, like iOS's "Show touches" in a screen
 * recording: it is drawn over the page, and it is the only thing that is. Everything under it is the
 * running app.
 *
 * Recording: Chrome's own screencast (each frame the compositor paints, with its timestamp), not
 * Playwright's recordVideo, which encodes at a fixed 1 Mbit/s and blurs text.
 *
 * Encoding happens in a browser, so there is no separate video tool to install -- Microsoft Edge,
 * whose H.264 output (what Safari and every iPhone need) is the one verified by playing it back.
 * (Playwright's Chromium here reports H.264 support too, 2026-10-27, but isn't the one tested.)
 *   - app-household.mp4 (H.264): Edge's WebCodecs VideoEncoder, frame by frame at 30 fps, packed by
 *     tools/mp4-mux.mjs. NOT Edge's MediaRecorder, whose MP4 froze between keyframes in playback.
 *   - app-household.webm (VP9): Edge's MediaRecorder, replaying the frames in real time, for any
 *     browser without H.264.
 *   - app-household-poster.jpg: the celebration, which reduced-motion visitors see instead.
 *
 * Each frame gets a status-bar band painted above it, in the colour of the app's own header in that
 * frame -- so when the celebration dims the app, the band dims with it. The page's phone frame draws
 * no band of its own for this clip (.device--clip, on top of the shared .device--solo placement): a CSS band stayed white over a dimmed screen.
 *
 * It LOGS ONE REAL SET for Sam. It notes the sets that existed before, deletes exactly the one it
 * added afterwards, and ends the workout only if it started one -- an open workout it found is
 * somebody else's (App Review uses this account) and is left alone.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { muxMp4 } from './mp4-mux.mjs';

const FRONTEND = process.env.FRONTEND || 'https://app.huddle.fitness';
const [WORK, OUT] = process.argv.slice(2);
const { EMAIL, PASSWORD } = process.env;
const ENCODE_ONLY = process.env.ENCODE_ONLY === '1';
if (!WORK || !OUT || (!ENCODE_ONLY && (!EMAIL || !PASSWORD))) throw new Error('usage: EMAIL=... PASSWORD=... ALLOW_WRITES=1 node tools/marketing-demo-clip.mjs <workDir> <outDir>');
if (!ENCODE_ONLY && process.env.ALLOW_WRITES !== '1') throw new Error('this logs a real set for Sam: set ALLOW_WRITES=1');
const FRAMES = join(WORK, 'frames');
mkdirSync(FRAMES, { recursive: true });
mkdirSync(OUT, { recursive: true });

const EXERCISE = 'Barbell Back Squat';
// 440 x 956 CSS px at about 1.64x, under a 44px status-bar band painted into every frame (below).
const VIDEO = { width: 720, height: 1564, band: 44, fps: 30 };

// ---------------------------------------------------------------- 1. record
if (!ENCODE_ONLY) {
const API = (await (await fetch(`${FRONTEND}/config.json`)).json()).apiUrl;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__ring = (x, y) => {
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;left:${x - 24}px;top:${y - 24}px;width:48px;height:48px;border-radius:50%;
      background:rgba(28,27,25,.16);border:2px solid rgba(255,255,255,.95);box-shadow:0 2px 10px rgba(0,0,0,.25);
      z-index:2147483647;pointer-events:none;transform:scale(.6);opacity:0;transition:transform .18s ease-out,opacity .18s ease-out`;
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1)'; r.style.opacity = '1'; });
    // Gone about a third of a second after the tap lands: a ring that lingers is still on screen
    // when the next thing appears, and "Nice" sits exactly where "Log set" was tapped.
    setTimeout(() => { r.style.transition = 'transform .28s ease-out,opacity .28s ease-out'; r.style.transform = 'scale(1.3)'; r.style.opacity = '0'; }, 220);
    setTimeout(() => r.remove(), 560);
  };
});
const settle = async () => {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('[class*="skeleton" i]'), null, { timeout: 30_000 });
  await page.waitForTimeout(600);
};
const person = (n) => page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(n) });
const openExercise = async (n) => {
  await page.getByRole('link', { name: 'Log', exact: true }).click();
  await settle();
  const back = page.getByRole('button', { name: /All exercises/ });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: n, exact: true }).first().click();
  await page.getByRole('button', { name: /^Log set/ }).waitFor();
  await settle();
};
// The ring shows a beat before the tap lands, so the eye is already there when the screen changes.
const tap = async (locator) => {
  const box = await locator.boundingBox();
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.evaluate(([x, y]) => window.__ring(x, y), [x, y]);
  await page.waitForTimeout(170);
  await page.touchscreen.tap(x, y);
};

await page.goto(`${FRONTEND}/login`);
await page.getByPlaceholder('Email').fill(EMAIL);
await page.getByPlaceholder('Password').fill(PASSWORD);
await page.getByPlaceholder('Password').press('Enter');
await page.waitForURL(/\/app\//, { timeout: 60_000 });
await settle();

const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
const call = async (method, path) => {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
};
const sam = (await call('GET', '/api/people')).find((p) => p.name === 'Sam');
const squat = (await call('GET', `/api/people/${sam.id}/exercises`)).find((e) => e.name === EXERCISE);
const liveBefore = await call('GET', `/api/people/${sam.id}/sessions/live`);
const setsBefore = new Set(liveBefore ? (await call('GET', `/api/sessions/${liveBefore.id}/sets?exerciseId=${squat.id}`)).map((s) => s.id) : []);

// Staging, off camera: Sam's Trends on the squat, then her Log on the squat (the app remembers both
// per person), then Alex's squat, where the clip starts.
await person('Sam').click(); await settle();
await openExercise(EXERCISE);
await page.getByRole('link', { name: 'Trends', exact: true }).click(); await settle();
await page.locator('select').last().selectOption({ label: EXERCISE });
// The app returns each person to the tab they were last on, so Sam goes back to her Log first.
await openExercise(EXERCISE);
await person('Alex').click(); await settle();
await openExercise(EXERCISE);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);

const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  frames.push({ data, t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
let posterFrame;
try {
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 880, maxHeight: 1912 });
  await page.waitForTimeout(500);                                   // Alex's squat
  await tap(person('Sam'));
  await page.waitForTimeout(950);                                   // Sam's numbers
  await tap(page.getByTitle('Increase Weight (lb)'));
  await page.waitForTimeout(450);
  await tap(page.getByTitle('Increase Reps'));
  await page.waitForTimeout(650);                                   // 195 x 6
  await tap(page.getByRole('button', { name: /^Log set/ }));
  await page.getByText('New PR!').waitFor();
  await page.waitForTimeout(800);
  posterFrame = frames.length - 1;                                  // confetti mid-air
  await page.waitForTimeout(700);                                   // the celebration
  await tap(page.getByRole('button', { name: 'Nice', exact: true }));
  await page.waitForTimeout(300);
  await tap(page.getByRole('link', { name: 'Trends', exact: true }));
  await page.waitForTimeout(350);
  // Her squat chart, scrolled up under the sticky bars with an eased scroll a thumb would make.
  const target = await page.getByText(/^Exercise progress/).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY - 150);
  await page.evaluate(async (to) => {
    const from = window.scrollY, dur = 800, t0 = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        window.scrollTo(0, from + (to - from) * e);
        k < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    });
  }, target);
  await page.waitForTimeout(300);
  // The rightmost point of the squat chart's own line: the set just logged. (The "?" help icons are
  // SVG circles too, so this looks only inside the Exercise progress card, at a chart with points.)
  const point = await page.getByText(/^Exercise progress/).first().evaluate((el) => {
    let card = el;
    while (card.parentElement && getComputedStyle(card).borderTopWidth === '0px') card = card.parentElement;
    const chart = [...card.querySelectorAll('svg')].find((svg) => svg.querySelectorAll('circle').length > 3);
    const r = [...chart.querySelectorAll('circle')].map((c) => c.getBoundingClientRect()).sort((a, b) => b.right - a.right)[0];
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.evaluate(([x, y]) => window.__ring(x, y), [point.x, point.y]);
  await page.waitForTimeout(170);
  await page.touchscreen.tap(point.x, point.y);                     // the point just logged
  await page.waitForTimeout(1400);
  await cdp.send('Page.stopScreencast');
} finally {
  // Exactly the set this run added; the workout only if this run started it.
  const live = await call('GET', `/api/people/${sam.id}/sessions/live`);
  if (live) {
    for (const s of await call('GET', `/api/sessions/${live.id}/sets?exerciseId=${squat.id}`)) {
      if (!setsBefore.has(s.id)) { await call('DELETE', `/api/sets/${s.id}`); console.log(`deleted set ${s.id}`); }
    }
    if (!liveBefore) { await call('POST', `/api/people/${sam.id}/sessions/live/end`); console.log(`ended workout ${live.id}`); }
    else console.log(`left workout ${live.id} open: it was there before this run`);
  }
  await browser.close();
}

const t0 = frames[0].t;
frames.forEach((f, i) => writeFileSync(join(FRAMES, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64')));
const timeline = frames.map((f) => +(f.t - t0).toFixed(4));
const duration = timeline.at(-1) + 0.3; // hold the last frame a beat before the loop
writeFileSync(join(WORK, 'timeline.json'), JSON.stringify({ timeline, duration, posterFrame }));
console.log(`recorded ${frames.length} frames over ${duration.toFixed(1)}s`);

}

// ---------------------------------------------------------------- 2. encode, in Edge
const { timeline: tl, duration: dur, posterFrame: at } = JSON.parse(readFileSync(join(WORK, 'timeline.json'), 'utf8'));
const files = readdirSync(FRAMES).sort();
const edge = await chromium.launch({ channel: 'msedge' });
const ep = await edge.newPage();
// localhost, so the page is a secure context: WebCodecs exists only in one.
await ep.route('http://localhost:9/**', (route) => {
  const name = new URL(route.request().url()).pathname.slice(1);
  if (name === '') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' });
  return route.fulfill({ path: join(FRAMES, name), contentType: 'image/jpeg' });
});
await ep.goto('http://localhost:9/');
await ep.evaluate((V) => {
  // The frame under a band the colour of its own header's top edge: white, or dimmed with the app.
  window.paint = (g, bmp) => {
    g.drawImage(bmp, 0, V.band, V.width, V.height);
    const [r, gr, b] = g.getImageData(V.width / 2, V.band + 2, 1, 1).data;
    g.fillStyle = `rgb(${r},${gr},${b})`;
    g.fillRect(0, 0, V.width, V.band);
  };
  window.toBase64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
}, VIDEO);

// MP4: one source frame per 1/30 s slot (the last one painted by then), encoded one by one, with a
// keyframe every second so a loop or a late start never waits long for a clean picture.
const h264 = await ep.evaluate(async ({ files, tl, dur, V }) => {
  const config = { codec: 'avc1.640028', width: V.width, height: V.height + V.band, bitrate: 2_500_000, framerate: V.fps, avc: { format: 'avc' }, latencyMode: 'quality' };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('Edge cannot encode H.264 here');
  const chunks = [];
  let avcC = null;
  let failed = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !avcC) avcC = window.toBase64(new Uint8Array(meta.decoderConfig.description));
      const d = new Uint8Array(chunk.byteLength);
      chunk.copyTo(d);
      chunks.push({ data: window.toBase64(d), key: chunk.type === 'key', ts: chunk.timestamp });
    },
    error: (e) => { failed = String(e); },
  });
  enc.configure(config);
  const canvas = document.querySelector('canvas');
  Object.assign(canvas, { width: V.width, height: V.height + V.band });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  let shown = -1;
  for (let k = 0, n = Math.round(dur * V.fps); k < n; k++) {
    const i = Math.max(0, tl.findLastIndex((t) => t <= k / V.fps + 1e-6));
    if (i !== shown) {
      const bmp = await createImageBitmap(await (await fetch(`/${files[i]}`)).blob(), { resizeWidth: V.width, resizeHeight: V.height, resizeQuality: 'high' });
      window.paint(g, bmp);
      bmp.close();
      shown = i;
    }
    const frame = new VideoFrame(canvas, { timestamp: Math.round((k * 1e6) / V.fps), duration: Math.round(1e6 / V.fps) });
    enc.encode(frame, { keyFrame: k % V.fps === 0 });
    frame.close();
    while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
  }
  await enc.flush();
  enc.close();
  if (failed) throw new Error(failed);
  return { avcC, chunks: chunks.sort((a, b) => a.ts - b.ts) };
}, { files, tl, dur, V: VIDEO });
writeFileSync(join(OUT, 'app-household.mp4'), muxMp4({
  width: VIDEO.width, height: VIDEO.height + VIDEO.band, fps: VIDEO.fps, avcC: Buffer.from(h264.avcC, 'base64'),
  samples: h264.chunks.map((c) => ({ data: Buffer.from(c.data, 'base64'), key: c.key })),
}));

// WebM: MediaRecorder, replaying the frames onto the canvas at their recorded times.
const vp9 = await ep.evaluate(async ({ files, tl, dur, V }) => {
  const canvas = document.querySelector('canvas');
  Object.assign(canvas, { width: V.width, height: V.height + V.band });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const blobs = await Promise.all(files.map(async (f) => (await fetch(`/${f}`)).blob()));
  const draw = async (i) => { const bmp = await createImageBitmap(blobs[i]); window.paint(g, bmp); bmp.close(); };
  await draw(0);
  const rec = new MediaRecorder(canvas.captureStream(V.fps), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start();
  const start = performance.now();
  for (let i = 1; i < files.length; i++) {
    const wait = start + tl[i] * 1000 - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await draw(i);
  }
  await new Promise((r) => setTimeout(r, Math.max(0, start + dur * 1000 - performance.now())));
  rec.stop();
  await stopped;
  return window.toBase64(new Uint8Array(await new Blob(chunks).arrayBuffer()));
}, { files, tl, dur, V: VIDEO });
writeFileSync(join(OUT, 'app-household.webm'), Buffer.from(vp9, 'base64'));

// The poster: the celebration, the frame reduced-motion visitors get instead of the clip.
const posterJpg = await ep.evaluate(async ({ f, V }) => {
  const c = document.querySelector('canvas');
  Object.assign(c, { width: V.width, height: V.height + V.band });
  window.paint(c.getContext('2d', { willReadFrequently: true }), await createImageBitmap(await (await fetch(`/${f}`)).blob()));
  return c.toDataURL('image/jpeg', 0.88).split(',')[1];
}, { f: files[at], V: VIDEO });
writeFileSync(join(OUT, 'app-household-poster.jpg'), Buffer.from(posterJpg, 'base64'));
await edge.close();
console.log('app-household.mp4, app-household.webm, app-household-poster.jpg');
