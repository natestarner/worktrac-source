// The browser matrix: real app, real service worker, real IndexedDB, against the target's
// multi-year account. Every scenario runs in a fresh profile and ends with the same claim the e2e
// parity specs make -- once the outbox is empty, the app's PERSISTED History for every person
// equals GET /history.
import path from 'node:path';
import { ENGINE_TIMEOUTS, blockOf, converge, dismiss, editButtons, goTab, headerOf, logSet, login, openPastWorkout,
  openProfile, persistedHistories, showHistory, pinOfflineAcrossReload, queuedWrites, readQueryCache, toExercise, traceSyncs,
  waitSynced, watchErrors, writeQueryCache } from '../lib/browser.mjs';
import { log, sleep } from '../lib/config.mjs';

const monthsBack = (n) => { const d = new Date(); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
const SYNC_URL = '**/history/sync';

// Runs one scenario in a fresh profile: log in, wait for the first sync, run, record, close.
async function scenario(ctx, name, fn) {
  const S = `browser:${ctx.engine}`;
  if (ctx.only && !ctx.only.includes(name)) return;
  const prof = await openProfile(ctx.engine);
  const started = Date.now();
  try {
    await login(prof.page, ctx.target.app, ctx.creds);
    await waitSynced(prof.page, String(ctx.api.personId), Math.min(ctx.seededWorkouts, 1000));
    const out = await fn(prof);
    for (const [check, result] of out) ctx.report.record(S, `${name}: ${check}`, result.ok ? 'pass' : 'fail', result.detail);
  } catch (e) {
    const shot = path.join(ctx.report.shotsDir, `${ctx.engine}-${name}.png`);
    await prof.page.screenshot({ path: shot }).catch(() => {});
    ctx.report.record(S, `${name}: ran to completion`, 'fail', String(e.message || e).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 1500), { screenshot: shot });
  } finally {
    if (prof.errors.length) ctx.report.record(S, `${name}: page/console errors`, 'warn', prof.errors.slice(0, 8).join('\n'));
    log(`[${ctx.engine}] ${name} took ${((Date.now() - started) / 1000).toFixed(0)}s`);
    await prof.close();
  }
}

// The device's own History, newest first -- the order History renders its blocks in.
async function held(page, personId) {
  return (await persistedHistories(page))[personId]?.flat ?? [];
}

// Index (= block position) of the newest finished workout in `month`, from what the device holds.
async function pickIn(page, personId, month) {
  const list = await held(page, personId);
  const i = list.findIndex((s) => s.startedAt.slice(0, 7) === month && s.endedAt !== null);
  if (i < 0) throw new Error(`the device holds no finished workout in ${month}`);
  return { index: i, session: list[i] };
}

// Log a set in today's workout, then wait until the device's History holds that workout -- so block
// positions computed afterwards count it. Within the engine's convergence budget, not a fixed 30s: the
// first scenario on a fresh WebKit profile is still persisting its five-year sign-in download, and
// failed at 30s there while the same wait passed in the very next scenario.
async function liveSet(page, api, cleanup, personId, timeoutMs) {
  await goTab(page, 'Log');
  await toExercise(page, 'Barbell Bench Press');
  await logSet(page);
  const live = await api.ok('GET', `/api/people/${personId}/sessions/live`);
  cleanup.touch(live?.id);
  const deadline = Date.now() + timeoutMs;
  let newest;
  while (Date.now() < deadline) {
    newest = (await held(page, personId))[0];
    if (newest?.id === live?.id) return live;
    await sleep(500);
  }
  throw new Error(`today's workout (${live?.id}) never reached the device's History in ${timeoutMs / 1000}s; `
    + `its newest was ${newest ? `${newest.id} at ${newest.startedAt}` : 'nothing at all'}`);
}

async function addSetsToPast(page, index, n, personId) {
  await showHistory(page, personId);
  await openPastWorkout(page, index);
  await toExercise(page, 'Barbell Row');
  for (let i = 0; i < n; i += 1) await logSet(page);
  await page.getByRole('button', { name: 'Done' }).click();
}

async function addLiveSets(page, n) {
  await goTab(page, 'Log');
  await toExercise(page, 'Barbell Bench Press');
  for (let i = 0; i < n; i += 1) await logSet(page);
}

const delaySyncs = (target, ms) => target.route(SYNC_URL, async (route) => {
  const response = await route.fetch();
  await sleep(ms);
  await route.fulfill({ response });
});

export async function browserMatrix(ctx) {
  const { api, cleanup, report } = ctx;
  const P = String(api.personId);
  const T = ENGINE_TIMEOUTS[ctx.engine];
  const everyone = async () => [P, ...(await api.ok('GET', '/api/people')).map((p) => String(p.id)).filter((id) => id !== P)];

  // Two writes to workouts in DIFFERENT months reaching the server back to back (#356). With syncs
  // answered late the two refreshes always overlap; at natural speed they usually don't.
  for (const delay of [0, 2000]) {
    await scenario(ctx, delay ? 'two-months-drain-slow-sync' : 'two-months-drain', async ({ ctx: c, page }) => {
      await liveSet(page, api, cleanup, P, T.converge);
      const past = await pickIn(page, P, monthsBack(1));
      cleanup.touch(past.session.id);
      if (delay) await delaySyncs(c, delay);
      await c.setOffline(true);
      await addSetsToPast(page, past.index, 1, P);
      await addLiveSets(page, 1);
      await c.setOffline(false);
      return [['a set in last month\'s workout and one in today\'s, drained together, both reach History', await converge(page, api, await everyone(), T.converge)]];
    });
  }

  await scenario(ctx, 'big-drain', async ({ ctx: c, page }) => {
    await liveSet(page, api, cleanup, P, T.converge);
    const targets = [];
    for (const n of [1, 2, 3]) { const t = await pickIn(page, P, monthsBack(n)); cleanup.touch(t.session.id); targets.push(t); }
    await c.setOffline(true);
    for (const t of targets) await addSetsToPast(page, t.index, 2, P);
    await addLiveSets(page, 4);
    await c.setOffline(false);
    return [['10 writes across 4 months, drained at once (past the scope bound of 8)', await converge(page, api, await everyone(), T.converge)]];
  });

  await scenario(ctx, 'drain-on-reopen', async ({ ctx: c, page }) => {
    await liveSet(page, api, cleanup, P, T.converge);
    const a = await pickIn(page, P, monthsBack(1));
    const b = await pickIn(page, P, monthsBack(2));
    cleanup.touch(a.session.id); cleanup.touch(b.session.id);
    await c.setOffline(true);
    await addSetsToPast(page, a.index, 2, P);
    await addSetsToPast(page, b.index, 2, P);
    await addLiveSets(page, 1);
    await sleep(2500);
    const reopened = await c.newPage();
    watchErrors(reopened, []);
    await page.close();
    await c.setOffline(false);
    await reopened.goto(`${ctx.target.app}/app/history`);
    return [['writes queued offline, app closed, reopened online: every write reaches History', await converge(reopened, api, await everyone(), T.converge)]];
  });

  await scenario(ctx, 'lost-responses', async ({ ctx: c, page }) => {
    await liveSet(page, api, cleanup, P, T.converge);
    const a = await pickIn(page, P, monthsBack(1));
    cleanup.touch(a.session.id);
    const rowId = await api.exerciseId('Barbell Row');
    const count = async () => (await api.setsOf(a.session.id, rowId)).length;
    const before = await count();
    await c.setOffline(true);
    await addSetsToPast(page, a.index, 2, P);
    await addLiveSets(page, 1);
    await sleep(1500);
    // The next two uploads REACH the server and commit; their responses never reach the app.
    let dropped = 0;
    await c.route(/\/api\/(sessions\/\d+\/sets|people\/\d+\/live-sets)$/, async (route) => {
      if (route.request().method() !== 'POST' || dropped >= 2) return route.continue();
      dropped += 1;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await c.setOffline(false);
    await sleep(4000);
    await c.setOffline(true);
    await c.unrouteAll({ behavior: 'ignoreErrors' });
    await sleep(2000);
    const reopened = await c.newPage();
    watchErrors(reopened, []);
    await page.close();
    await c.setOffline(false);
    await reopened.goto(`${ctx.target.app}/app/history`);
    const result = await converge(reopened, api, await everyone(), T.converge);
    const after = await count();
    return [
      [`signal lost mid-upload (${dropped} responses dropped), app reopened: History == server`, result],
      ['no set stored twice after the replays', { ok: after - before === 2, detail: `${after - before} set(s) added to that workout's Barbell Row (expected 2)` }],
    ];
  });

  if (ctx.engine === 'webkit') report.record(`browser:${ctx.engine}`, 'two-tabs', 'skip', 'needs a navigation while offline, which Playwright\'s WebKit cannot do (see cold-boot-offline)');
  else await scenario(ctx, 'two-tabs', async ({ ctx: c, page }) => {
    const a = await pickIn(page, P, monthsBack(1));
    cleanup.touch(a.session.id);
    const offlineTab = await c.newPage();
    await pinOfflineAcrossReload(offlineTab);
    await c.setOffline(true);
    await page.close();
    await offlineTab.goto(`${ctx.target.app}/app/history`);
    await offlineTab.getByText(/×/).first().waitFor();
    await addSetsToPast(offlineTab, a.index, 2, P);
    await sleep(2500);
    await c.setOffline(false);
    const online = await c.newPage();
    watchErrors(online, []);
    await online.goto(`${ctx.target.app}/app/history`);
    await sleep(4000);
    await offlineTab.close();
    return [['a stale offline tab and an online tab during the drain: History == server', await converge(online, api, await everyone(), T.converge)]];
  });

  await scenario(ctx, 'other-device-on-open', async ({ ctx: c, page }) => {
    const other = await pickIn(page, P, monthsBack(2));
    cleanup.touch(other.session.id);
    await c.setOffline(true);
    await addLiveSets(page, 1);
    await sleep(2500);
    const reopened = await c.newPage();
    watchErrors(reopened, []);
    await page.close();
    // Another device adds a set to a workout two months back while this one is closed.
    await api.ok('POST', `/api/sessions/${other.session.id}/sets`, { exerciseId: await api.exerciseId('Barbell Row'), weight: 99, reps: 9 });
    await delaySyncs(c, 2000);
    await c.setOffline(false);
    await reopened.goto(`${ctx.target.app}/app/history`);
    return [['app opened with a queued set picks up another device\'s change in another month (#357)', await converge(reopened, api, await everyone(), T.converge)]];
  });

  if (ctx.engine === 'webkit') {
    report.record(`browser:${ctx.engine}`, 'cold-boot-offline', 'skip', 'Playwright\'s WebKit cannot navigate while its offline emulation is on ("internal error") -- check it by hand on an iPhone');
  } else {
    await scenario(ctx, 'cold-boot-offline', async ({ ctx: c, page }) => {
      await sleep(2500);
      const offlinePage = await c.newPage();
      await pinOfflineAcrossReload(offlinePage);
      await c.setOffline(true);
      await page.close();
      const t0 = Date.now();
      await offlinePage.goto(`${ctx.target.app}/app/history`);
      await offlinePage.getByText(/×/).first().waitFor();
      const shownMs = Date.now() - t0;
      const lines = await offlinePage.locator('text=/lb\\s?×/').count();
      await addLiveSets(offlinePage, 1);
      await sleep(2000);
      await c.setOffline(false);
      const online = await c.newPage();
      watchErrors(online, []);
      await online.goto(`${ctx.target.app}/app/history`);
      await offlinePage.close();
      return [
        ['opened with no network at all: cached History painted', { ok: lines > 0, detail: `${lines} set lines in ${(shownMs / 1000).toFixed(1)}s` }],
        ['then online: the offline set drained and History == server', await converge(online, api, await everyone(), T.converge)],
      ];
    });
  }

  await scenario(ctx, 'lie-fi', async ({ ctx: c, page }) => {
    await c.route(/\/api\//, () => { /* never answered: the app's own 15s abort fires */ });
    await page.reload();
    await page.getByText(/×/).first().waitFor();
    await addLiveSets(page, 1);
    await sleep(20000);
    await c.unrouteAll({ behavior: 'ignoreErrors' });
    return [
      ['every API call hanging: cached History still renders', { ok: true, detail: 'rendered' }],
      ['API back: the queued set drained and History == server', await converge(page, api, await everyone(), T.converge)],
    ];
  });

  await scenario(ctx, 'old-format-upgrade', async ({ ctx: c, page }) => {
    await sleep(2500);
    await page.goto(`${ctx.target.app}/boot-watchdog.js`); // same origin, no app running to persist over us
    const cache = await readQueryCache(page);
    let rewritten = 0;
    for (const q of cache.clientState.queries) {
      if (q.queryKey[0] === 'history' && q.state?.data?.months) {
        const flat = Object.keys(q.state.data.months).sort().reverse().flatMap((m) => q.state.data.months[m].sessions);
        q.state.data = [...flat, { id: 987654321, startedAt: '2019-01-10T10:00:00Z', endedAt: '2019-01-10T11:00:00Z', manual: true, entries: [{ exerciseId: 1, exerciseName: 'Barrage Legacy Marker', sets: [{ weight: 42, reps: 7, durationSeconds: null, unit: 'lb' }], note: null }] }];
        rewritten += 1;
      }
    }
    await writeQueryCache(page, cache);
    await c.route(/\/api\//, (r) => r.abort('internetdisconnected'));
    await page.goto(`${ctx.target.app}/app/history`);
    await page.getByText('Barrage Legacy Marker').waitFor();
    await c.unrouteAll({ behavior: 'ignoreErrors' });
    await page.reload();
    const result = await converge(page, api, await everyone(), T.converge);
    const formats = Object.values(await persistedHistories(page)).map((h) => h.raw?.format ?? 'array');
    const markerGone = (await page.getByText('Barrage Legacy Marker').count()) === 0;
    return [
      [`a cache in the pre-sync array format (${rewritten} people) renders while unreachable`, { ok: true, detail: 'marker visible' }],
      ['the first sync replaces it: History == server', result],
      ['every History now in the month format, marker gone', { ok: formats.every((f) => f === 2) && markerGone, detail: `formats ${JSON.stringify(formats)}, marker gone ${markerGone}` }],
    ];
  });

  // The rolling check replaced the daily full sync: a device whose months are all due for a re-read
  // (`checked` cleared) re-reads one per ordinary sync and never downloads everything. It plants no
  // drift -- a valid drift report writes the one log line `ops` fails on -- so it checks the check
  // RAN and stayed quiet; history-sync.spec.ts plants drift locally.
  await scenario(ctx, 'rolling-check', async ({ ctx: c, page }) => {
    await sleep(2500);
    await page.goto(`${ctx.target.app}/boot-watchdog.js`);
    const cache = await readQueryCache(page);
    for (const q of cache.clientState.queries) if (q.queryKey[0] === 'history' && q.state?.data?.months) q.state.data.checked = {};
    await writeQueryCache(page, cache);
    const syncs = traceSyncs(page, 'rolling');
    let drift = 0;
    let audited = 0;
    page.on('request', (r) => { if (/\/history\/drift$/.test(r.url())) drift += 1; });
    page.on('response', async (r) => {
      if (!/\/history\/sync$/.test(new URL(r.url()).pathname)) return;
      const body = await r.json().catch(() => ({}));
      audited += Object.keys(body.audited ?? {}).length;
    });
    await page.goto(`${ctx.target.app}/app/history`);
    const result = await converge(page, api, await everyone(), T.converge);
    const kinds = syncs.map((s) => `${s.kind}${s.audit ? '+audit' : ''}`);
    return [
      ['a device with every month due a re-read: History == server', result],
      ['ordinary syncs carried the check, the server answered it, nothing re-downloaded everything, no drift',
        { ok: syncs.some((s) => s.kind === 'ordinary' && s.audit === 1) && audited > 0 && !syncs.some((s) => s.kind === 'full') && drift === 0,
          detail: `syncs ${JSON.stringify(kinds)}, audited months ${audited}, drift reports ${drift}` }],
    ];
  });

  await scenario(ctx, 'multi-person', async ({ ctx: c, page }) => {
    const kid = await api.ok('POST', '/api/people', { name: `Barrage Kid ${ctx.runId}` });
    cleanup.addPerson(kid.id);
    const squat = await api.exerciseId('Barbell Back Squat');
    for (const month of [monthsBack(2), monthsBack(1)]) {
      const s = await api.ok('POST', `/api/people/${kid.id}/sessions`, { startedAt: `${month}-15T17:00:00Z` });
      await api.ok('POST', `/api/sessions/${s.id}/sets`, { exerciseId: squat, weight: 65, reps: 8 });
    }
    await page.reload();
    await sleep(3000);
    await dismiss(page);
    await page.getByRole('button', { name: new RegExp(`Barrage Kid ${ctx.runId}`) }).first().click();
    await goTab(page, 'History');
    await page.getByText(/65\s?lb\s?×\s?8/).first().waitFor();
    await addLiveSets(page, 1);
    const result = await converge(page, api, [P, String(kid.id)], T.converge);
    const h = await persistedHistories(page);
    const mine = new Set((h[P]?.flat ?? []).map((s) => s.id));
    const kids = (h[String(kid.id)]?.flat ?? []).map((s) => s.id);
    const overlap = kids.filter((id) => mine.has(id));
    return [
      ['two people: each persisted History == that person\'s server History', result],
      ['per-person isolation: no workout in both people\'s History', { ok: overlap.length === 0 && kids.length >= 2, detail: `second person holds ${kids.length} workouts, overlap ${overlap.length}` }],
    ];
  });

  await scenario(ctx, 'long-jump', async ({ page }) => {
    await showHistory(page, P);
    const list = await held(page, P);
    const target = list.findIndex((s) => s.startedAt.slice(0, 7) === monthsBack(24) && s.endedAt !== null);
    if (target < 0) throw new Error(`no workout two years back (${monthsBack(24)}) to jump to`);
    const cv = await blockOf(page, 0).evaluate((el) => getComputedStyle(el).contentVisibility);
    const header = headerOf(page, target);
    const label = (await header.textContent()).trim();
    const handle = await header.elementHandle();
    const options = blockOf(page, target).getByRole('button', { name: /^View options for / }).first();
    await options.scrollIntoViewIfNeeded();
    await options.click();
    // What the target does after the jump, every 100ms for 4s, in the page itself: where it is, whether
    // it is still the element on screen, and whether the page scrolled or the layout moved under it.
    // WebKit missed by 117px once on lower (2026-09-26) and not in 3/3 local WebKit runs; this is what
    // tells a scroll that stopped short from a layout that moved after it, or a re-render.
    await handle.evaluate((el) => {
      const w = window;
      w.__jump = [];
      const t0 = performance.now();
      const id = setInterval(() => {
        const r = el.getBoundingClientRect();
        w.__jump.push([Math.round(performance.now() - t0), Math.round(r.top), el.isConnected ? 1 : 0, Math.round(scrollY), document.documentElement.scrollHeight]);
        if (performance.now() - t0 > 4000) clearInterval(id);
      }, 100);
    });
    await page.getByRole('button', { name: /View this exercise.s history/ }).click();
    let last = -1;
    for (let i = 0; i < 40; i += 1) { const y = await page.evaluate(() => window.scrollY); if (y === last) break; last = y; await sleep(300); }
    await sleep(4200);
    const trace = await page.evaluate(() => (window.__jump || []).filter((s, i, a) => i === 0 || i === a.length - 1 || s.slice(1).join() !== a[i - 1].slice(1).join()));
    const pos = await handle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
      return { top: Math.round(r.top), inView: r.top >= 0 && r.bottom <= innerHeight, covered: !(hit && (hit === el || el.contains(hit))) };
    });
    return [
      ['History blocks skip off-screen rendering (content-visibility: auto)', { ok: cv === 'auto', detail: `computed: ${cv}` }],
      ['"View this exercise\'s history" on a workout two years down lands it visible, clear of the tab bar', { ok: pos.inView && !pos.covered,
        detail: `${label} at top=${pos.top}px covered=${pos.covered}; changes [ms, top, attached, scrollY, pageHeight]: ${JSON.stringify(trace)}` }],
    ];
  });
}

// A fresh device signing in: exactly ONE full sync per person (#358). Measured twice -- with no
// workout in progress (must be one), and with one in progress, where the Log tab's own refresh on
// load replaces the first full download still in flight, so it downloads twice (known, found by the
// barrage's first run on 2026-09-26; recorded as a WARN so a change either way is seen).
export async function signInOnce(ctx) {
  const S = `browser:${ctx.engine}`;
  const { api } = ctx;
  const bench = await api.exerciseId('Barbell Bench Press');
  for (const midWorkout of [false, true]) {
    await api.req('POST', `/api/people/${api.personId}/sessions/live/end`);
    let setId = null;
    if (midWorkout) {
      const w = await api.ok('POST', `/api/people/${api.personId}/live-sets`, { exerciseId: bench, weight: 50, reps: 1 });
      setId = w.set.id;
      ctx.cleanup.touch(w.session.id);
    }
    const label = midWorkout ? 'sign-in with a workout in progress: full History syncs per person' : 'sign-in: exactly one full History sync per person';
    const prof = await openProfile(ctx.engine);
    try {
      const syncs = traceSyncs(prof.page, 'sign-in');
      await login(prof.page, ctx.target.app, ctx.creds);
      await goTab(prof.page, 'History');
      await prof.page.getByText(/×/).first().waitFor();
      await sleep(8000);
      const people = (await api.ok('GET', '/api/people')).map((p) => String(p.id));
      const fulls = Object.fromEntries(people.map((id) => [id, syncs.filter((x) => x.person === id && x.kind === 'full').length]));
      const one = Object.values(fulls).every((n) => n === 1);
      const status = one ? 'pass' : midWorkout ? 'warn' : 'fail';
      ctx.report.record(S, label, status, `full syncs by person ${JSON.stringify(fulls)}; all ${JSON.stringify(syncs.map((x) => `${x.person}:${x.kind}`))}`
        + (!one && midWorkout ? ' -- known: the Log tab refreshes on load and replaces the first download in flight' : ''));
    } catch (e) {
      ctx.report.record(S, label, 'fail', String(e.message || e).slice(0, 800));
    } finally {
      await prof.close();
      if (setId) await api.req('DELETE', `/api/sets/${setId}`);
      await api.req('POST', `/api/people/${api.personId}/sessions/live/end`);
    }
  }
}
