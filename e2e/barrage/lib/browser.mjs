// Browser helpers for the barrage's scenarios: Playwright (from e2e/node_modules) driving the REAL
// deployed app, with the app's persisted cache and outbox read straight out of IndexedDB.
//
// Every scenario gets a fresh persistent profile (service worker, IndexedDB, localStorage all its
// own) -- state left by one scenario (an active filter, a second person selected) once made the next
// fail for reasons that had nothing to do with the app.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { E2E_DIR, log, sleep } from './config.mjs';

const require = createRequire(path.join(E2E_DIR, 'package.json'));
export const playwright = require('@playwright/test');

// WebKit on Windows (Playwright's build) is far slower than Safari on a phone: leaving a five-year
// History took ~57s there against ~9s in Chromium, with production's build too. Its timeouts are
// sized for that, so a slow engine reads as slow, not as broken.
export const ENGINE_TIMEOUTS = {
  chromium: { action: 30000, converge: 90000 },
  webkit: { action: 120000, converge: 180000 },
};

export async function openProfile(engine) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `barrage-${engine}-`));
  const options = engine === 'chromium'
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 390, height: 844 } };
  const ctx = await playwright[engine].launchPersistentContext(dir, options);
  ctx.setDefaultTimeout(ENGINE_TIMEOUTS[engine].action);
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  watchErrors(page, errors);
  return {
    ctx, page, engine, errors,
    async close() {
      await ctx.close().catch(() => {});
      // Windows can hold the profile's files for a moment after the browser exits; a leftover temp
      // folder is not worth failing a run over.
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* leave it */ }
    },
  };
}

// Page errors and console errors, minus network noise every connectivity scenario produces on purpose.
export function watchErrors(page, errors) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR|status of 50[234]|NetworkError|Load failed|no-response|access control checks/.test(t)) return;
    errors.push(`console: ${t.slice(0, 200)}`);
  });
}

export async function login(page, app, { email, password }) {
  await page.goto(`${app}/login`);
  await page.getByPlaceholder('Email', { exact: true }).fill(email);
  await page.getByPlaceholder('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/app\//, { timeout: 180000 });
  await sleep(2500);
  await dismiss(page);
}

export async function dismiss(page) {
  for (const name of ['Not now', 'Skip tour']) {
    const b = page.getByRole('button', { name });
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
  const pr = page.getByText('New PR!');
  if (await pr.isVisible().catch(() => false)) await pr.click({ force: true }).catch(() => {});
}

export const goTab = (page, name) => page.getByLabel('Sections').getByRole('link', { name, exact: true }).click();

export async function toExercise(page, name) {
  const picker = page.getByPlaceholder('Search all exercises');
  await picker.or(page.getByRole('button', { name: /All exercises/ })).first().waitFor();
  if (!(await picker.isVisible())) {
    await page.getByRole('button', { name: /All exercises/ }).first().click();
    await picker.waitFor();
  }
  await picker.fill(name);
  await page.getByRole('button', { name, exact: true }).first().click();
  await page.getByRole('button', { name: 'Log set' }).waitFor();
}

// Logs the prefilled set and waits for its row.
export async function logSet(page) {
  const before = await page.getByText(/^Set \d+$/).count();
  await page.getByRole('button', { name: 'Log set' }).click();
  await sleep(400);
  await dismiss(page);
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^Set \d+$/.test(e.textContent || '')).length > n,
    before,
  );
}

// ── History on screen ──────────────────────────────────────────────────────────────────────────

// History renders one block per workout, newest first -- the order of GET /history -- and every
// block has exactly one "Edit" button beside its date. So a workout's index in the server's list is
// its block's index on screen, which finds a workout without relying on date labels (they omit the
// year, so "Aug 30" matches one block per year of History).
export const editButtons = (page) => page.getByRole('button', { name: 'Edit', exact: true });
export const headerOf = (page, index) => editButtons(page).nth(index).locator('xpath=..').locator('xpath=./*[1]');
export const blockOf = (page, index) => editButtons(page).nth(index).locator('xpath=../..');

// Opens History and waits until it has actually replaced the previous screen and drawn its first
// page: one block per workout the device holds for `personId`, up to the first page (History draws
// its newest workouts first and more as the list scrolls -- frontend useGrowingList.js). Clicking
// the tab returns before the route changes, and in WebKit (slower) an "Edit" lookup right after the
// click found an element of the Log screen.
export const HISTORY_FIRST_PAGE = 40;
const drawnBlocks = (page) => page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Edit').length);

export async function showHistory(page, personId, timeoutMs = 180000) {
  await goTab(page, 'History');
  await page.waitForURL(/\/app\/history/, { timeout: timeoutMs });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const want = (await persistedHistories(page))[personId]?.flat?.length ?? -1;
    const have = await drawnBlocks(page);
    if (want > 0 && have === Math.min(want, HISTORY_FIRST_PAGE)) return have;
    await sleep(500);
  }
  throw new Error('History never finished drawing its first page of workouts');
}

// Scrolls History until the workout at `index` (its position in GET /history) is drawn.
export async function revealBlock(page, index, timeoutMs = 180000) {
  const t0 = Date.now();
  while ((await drawnBlocks(page)) <= index) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`History never drew workout #${index}`);
    const more = page.getByTestId('history-more');
    if (await more.count()) await more.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300);
  }
}

export async function openPastWorkout(page, index) {
  await revealBlock(page, index);
  const edit = editButtons(page).nth(index);
  await edit.scrollIntoViewIfNeeded();
  await edit.click();
  await page.getByText('Adding/editing past session').waitFor();
}

// ── The app's persisted state (IndexedDB, idb-keyval's store) ────────────────────────────────

export const readQueryCache = (page) => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('keyval-store');
  open.onerror = () => resolve(null);
  open.onsuccess = () => {
    try {
      const get = open.result.transaction('keyval', 'readonly').objectStore('keyval').get('worktrac-query-cache');
      get.onsuccess = () => resolve(get.result ? JSON.parse(get.result) : null);
      get.onerror = () => resolve(null);
    } catch { resolve(null); }
  };
}));

export const writeQueryCache = (page, value) => page.evaluate((v) => new Promise((resolve, reject) => {
  const open = indexedDB.open('keyval-store');
  open.onsuccess = () => {
    const put = open.result.transaction('keyval', 'readwrite').objectStore('keyval').put(JSON.stringify(v), 'worktrac-query-cache');
    put.onsuccess = () => resolve();
    put.onerror = () => reject(put.error);
  };
}), value);

// Writes still waiting in the persisted outbox (lib/outboxPersistence.js keys).
export const queuedWrites = (page) => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('keyval-store');
  open.onerror = () => resolve(-1);
  open.onsuccess = () => {
    try {
      const store = open.result.transaction('keyval', 'readonly').objectStore('keyval');
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        const outbox = keys.result.filter((k) => String(k).startsWith('worktrac-outbox:'));
        if (!outbox.length) return resolve(0);
        let n = 0;
        let left = outbox.length;
        for (const k of outbox) {
          const g = store.get(k);
          g.onsuccess = () => {
            const v = typeof g.result === 'string' ? JSON.parse(g.result) : g.result;
            n += v?.mutations?.length ?? 0;
            if (--left === 0) resolve(n);
          };
          g.onerror = () => { if (--left === 0) resolve(n); };
        }
      };
    } catch { resolve(-1); }
  };
}));

export function flattenHistory(data) {
  if (Array.isArray(data)) return data;
  if (!data?.months) return null;
  return Object.keys(data.months).sort().reverse().flatMap((m) => data.months[m].sessions);
}

export async function persistedHistories(page) {
  const cache = await readQueryCache(page);
  const out = {};
  for (const q of cache?.clientState?.queries ?? []) {
    if (q.queryKey?.[0] === 'history' && q.queryKey.length === 2 && q.state?.data != null) {
      out[q.queryKey[1]] = { flat: flattenHistory(q.state.data), raw: q.state.data };
    }
  }
  return out;
}

// Until this person's History has finished its first sync and reached disk (format 2, >= min).
export async function waitSynced(page, personId, min = 1, timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const held = (await persistedHistories(page))[personId];
    if (held?.raw?.format === 2 && held.flat.length >= min) return Date.now() - t0;
    await sleep(500);
  }
  throw new Error(`History for person ${personId} never finished its first sync`);
}

// THE check every scenario ends with: once the outbox is empty, the app's PERSISTED History for
// every person equals GET /history. Polls GET /history no faster than every 5s -- a five-year
// History costs the database ~2.8s per call, and polling it every 1.5s once saturated lower.
export async function converge(page, api, personIds, timeoutMs) {
  const t0 = Date.now();
  let queued = await queuedWrites(page);
  while (queued > 0 && Date.now() - t0 < timeoutMs) { await sleep(1000); queued = await queuedWrites(page); }
  if (queued > 0) return { ok: false, detail: `${queued} write(s) still queued after ${timeoutMs / 1000}s` };
  await goTab(page, 'History').catch(() => {}); // open History the way a person would
  let detail = '';
  while (Date.now() - t0 < timeoutMs) {
    const held = await persistedHistories(page);
    let ok = true;
    for (const id of personIds) {
      const flat = held[id]?.flat;
      if (!flat) { ok = false; detail = `person ${id}: nothing persisted`; break; }
      const truth = await api.truth(id);
      const a = JSON.stringify(flat);
      const b = JSON.stringify(truth);
      if (a !== b) {
        ok = false;
        const am = new Map(flat.map((s) => [s.id, JSON.stringify(s)]));
        const bm = new Map(truth.map((s) => [s.id, JSON.stringify(s)]));
        const diff = [...new Set([...am.keys(), ...bm.keys()])].filter((k) => am.get(k) !== bm.get(k)).slice(0, 4);
        detail = `person ${id}: app ${flat.length} workouts / server ${truth.length}; differing ids ${JSON.stringify(diff)}`
          + (diff.length ? `\n  app:    ${(am.get(diff[0]) || 'MISSING').slice(0, 400)}\n  server: ${(bm.get(diff[0]) || 'MISSING').slice(0, 400)}` : '');
        break;
      }
    }
    if (ok) return { ok: true, detail: `persisted History == server for ${personIds.length} person(s) after ${((Date.now() - t0) / 1000).toFixed(1)}s` };
    await sleep(5000);
  }
  return { ok: false, detail };
}

// Logs every History sync the page sends and what came back.
export function traceSyncs(page, label, sink = []) {
  page.on('request', (r) => {
    if (!/\/history\/sync$/.test(new URL(r.url()).pathname)) return;
    const b = JSON.parse(r.postData() || '{}');
    sink.push({ t: Date.now(), kind: b.sessions ? 'scoped' : Object.keys(b.have || {}).length ? 'ordinary' : 'full', audit: b.audit?.length ?? 0, person: new URL(r.url()).pathname.split('/')[3] });
  });
  page.on('requestfinished', async (r) => {
    if (!/\/history\/sync$/.test(new URL(r.url()).pathname)) return;
    if (process.env.BARRAGE_VERBOSE) log(`[${label}] sync <- ${(await r.response())?.status()}`);
  });
  return sink;
}

// Blocks later documents from ever seeing navigator.onLine === true, the one fact Playwright's
// offline emulation drops on a reload (e2e/tests/support/offline.ts#keepHardOfflineAcrossReload).
export const pinOfflineAcrossReload = (page) => page.addInitScript(() => {
  Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
});
