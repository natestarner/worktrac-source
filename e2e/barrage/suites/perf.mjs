// What a person with years of History actually waits for, in a phone-sized Chromium with the CPU
// throttled 4x (roughly a mid-range phone): first load, reload, logging a set, and where paint time
// goes. Plus the cold start: the app opened while the backend is scaled to zero.
import { converge, dismiss, goTab, login, openProfile, playwright, traceSyncs, waitSynced } from '../lib/browser.mjs';
import { log, sleep } from '../lib/config.mjs';
import { replicaCount } from '../lib/ops.mjs';

const median = (xs) => { const s = [...xs].filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const HISTORY_RE = /\/api\/people\/\d+\/history(\/sync)?$/;

async function metrics(cdp) {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const o = Object.fromEntries(m.map((x) => [x.name, x.value]));
  return { script: o.ScriptDuration * 1000, layout: o.LayoutDuration * 1000, style: o.RecalcStyleDuration * 1000, nodes: o.Nodes };
}

async function oneRun(ctx) {
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  // At 4x CPU throttle, leaving a five-year History for another tab alone takes ~40s (it tears down
  // ~200k elements) -- the default 30s would time the run out, not measure it.
  page.setDefaultTimeout(240000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const responses = [];
  page.on('response', async (r) => {
    if (!HISTORY_RE.test(new URL(r.url()).pathname)) return;
    const sizes = await r.request().sizes().catch(() => null);
    responses.push({ ms: r.request().timing().responseEnd, wire: sizes?.responseBodySize ?? null });
  });
  try {
    await login(page, ctx.target.app, ctx.creds);
    let t0 = Date.now();
    await goTab(page, 'History');
    await page.getByText(/lb\s?×/).first().waitFor({ timeout: 180000 });
    const firstLoad = Date.now() - t0;
    await page.waitForLoadState('networkidle');
    await sleep(2500);
    const before = responses.length;
    const m0 = await metrics(cdp);
    t0 = Date.now();
    // Opened again, not reloaded: a reload ON History is the person asking for all of it (#362).
    await page.goto(page.url());
    await page.getByText(/lb\s?×/).first().waitFor({ timeout: 180000 });
    const reloadPaint = Date.now() - t0;
    const m1 = await metrics(cdp);
    for (let i = 0; i < 900 && responses.length === before; i += 1) await sleep(100);
    const reloadResp = responses.at(-1);
    await goTab(page, 'Log');
    const search = page.getByPlaceholder('Search all exercises');
    await search.or(page.getByRole('button', { name: 'Log set' })).first().waitFor({ timeout: 120000 });
    if (await search.isVisible()) { await search.fill('Barbell Bench Press'); await page.getByRole('button', { name: 'Barbell Bench Press', exact: true }).first().click(); }
    await page.getByRole('button', { name: 'Log set' }).waitFor({ timeout: 120000 });
    await page.waitForLoadState('networkidle');
    const beforeSet = responses.length;
    await page.getByRole('button', { name: 'Log set' }).click();
    await sleep(400);
    await dismiss(page);
    for (let i = 0; i < 900 && responses.length === beforeSet; i += 1) await sleep(100);
    const setResp = responses.at(-1);
    return {
      firstLoad, reloadPaint, reloadScript: m1.script - m0.script, reloadStyle: m1.style - m0.style, reloadLayout: m1.layout - m0.layout,
      nodes: m1.nodes, reloadWire: reloadResp?.wire, setWire: setResp?.wire, setRtt: setResp?.ms,
    };
  } finally {
    await browser.close();
  }
}

export async function perf(ctx, runs = 3) {
  const S = 'perf';
  const results = [];
  for (let i = 0; i < runs; i += 1) {
    try { results.push(await oneRun(ctx)); log(`[perf] run ${i + 1}/${runs} done`); } catch (e) { ctx.report.record(S, `run ${i + 1}`, 'warn', String(e.message).slice(0, 300)); }
  }
  const api = ctx.api;
  await api.req('POST', `/api/people/${api.personId}/sessions/live/end`);
  const live = results.length;
  if (!live) return ctx.report.record(S, 'browser timings', 'fail', 'no run completed');
  const m = (k) => median(results.map((r) => r[k]));
  const s = (x) => (x == null ? '?' : `${(x / 1000).toFixed(1)} s`);
  const kb = (x) => (x == null ? '?' : `${(x / 1024).toFixed(1)} KB`);
  ctx.report.table(`Phone-sized Chromium, CPU throttled 4x (median of ${live})`, ['Measure', 'Value'], [
    ['History first load on a fresh device (tap -> first set shown)', s(m('firstLoad'))],
    ['Reload on History: cached content painted', s(m('reloadPaint'))],
    ['Reload: main-thread script / style / layout', `${s(m('reloadScript'))} / ${s(m('reloadStyle'))} / ${s(m('reloadLayout'))}`],
    ['Reload: History response over the wire', kb(m('reloadWire'))],
    ['Log a set: History response over the wire', kb(m('setWire'))],
    ['Log a set: History round trip', m('setRtt') == null ? '?' : `${Math.round(m('setRtt'))} ms`],
    ['DOM nodes on History', String(m('nodes'))],
  ]);
  // Guards on what the History work must keep true, whatever the absolute speed of the day:
  // a reload and a logged set move almost nothing over the wire, and style/layout stay small
  // (content-visibility skips the off-screen workouts).
  ctx.report.record(S, 'a reload downloads almost nothing (< 5 KB)', (m('reloadWire') ?? 1e9) < 5 * 1024 ? 'pass' : 'fail', kb(m('reloadWire')));
  ctx.report.record(S, 'a logged set\'s History refresh is small (< 20 KB)', (m('setWire') ?? 1e9) < 20 * 1024 ? 'pass' : 'fail', kb(m('setWire')));
  ctx.report.record(S, 'History reload style + layout stays small (< 1.5 s throttled)', (m('reloadStyle') + m('reloadLayout')) < 1500 ? 'pass' : 'fail',
    `${s(m('reloadStyle'))} + ${s(m('reloadLayout'))}`);
}

// PRs and Trends on the same phone: what opening each costs today, while both are answered by
// StatsService loading every set the person has logged. The baseline for moving them onto the
// History the device already holds (docs/architecture/history-sync.md, "Not covered here").
const STATS_RE = /\/api\/people\/\d+\/(prs|trends\/overview|trends\/exercises\/\d+|exercises\/\d+\/records)$/;

async function oneStatsRun(ctx) {
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const responses = [];
  page.on('response', async (r) => {
    const u = new URL(r.url());
    const m = u.pathname.match(STATS_RE);
    if (!m) return;
    const sizes = await r.request().sizes().catch(() => null);
    responses.push({ kind: m[1].replace(/\d+/g, '{id}') + (u.searchParams.get('weeks') ? `?weeks=${u.searchParams.get('weeks')}` : ''), ms: r.request().timing().responseEnd, wire: sizes?.responseBodySize ?? null });
  });
  try {
    await login(page, ctx.target.app, ctx.creds);
    // History fully held first, so the numbers below are what a returning person sees, and so the
    // same measurement can later be repeated against a History-derived board without changing it.
    await waitSynced(page, String(ctx.api.personId), Math.min(ctx.seededWorkouts, 1000));
    await page.waitForLoadState('networkidle');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const step = async (fn) => {
      const m0 = await metrics(cdp);
      const t0 = Date.now();
      await fn();
      return { ms: Date.now() - t0, script: (await metrics(cdp)).script - m0.script };
    };
    const prs = await step(async () => { await goTab(page, 'PRs'); await page.getByTestId('pr-row').first().waitFor(); });
    const trends = await step(async () => {
      await goTab(page, 'Trends');
      await page.getByTestId('consistency-grid').waitFor();
      await page.getByText(/^Exercise progress ·/).first().waitFor();
    });
    await page.waitForLoadState('networkidle');
    const range = page.getByRole('group', { name: 'Time range' });
    // Waits on what is RENDERED, not on a request: since Trends is derived from History on the
    // device (prs-trends-from-history.md) there is no overview request to wait for, and a build from
    // before that still makes one -- networkidle covers both, so either build can be measured.
    const all = await step(async () => {
      await range.getByRole('button', { name: 'All', exact: true }).click();
      await page.waitForLoadState('networkidle');
      await page.getByText(/^Exercise progress ·/).first().waitFor();
    });
    const back = await step(async () => {
      await range.getByRole('button', { name: '12wk', exact: true }).click();
      await page.waitForLoadState('networkidle');
    });
    return { prs, trends, all, back, responses };
  } finally {
    await browser.close();
  }
}

export async function statsPerf(ctx, runs = 3) {
  const S = 'perf:stats';
  const results = [];
  for (let i = 0; i < runs; i += 1) {
    try { results.push(await oneStatsRun(ctx)); log(`[perf:stats] run ${i + 1}/${runs} done`); } catch (e) { ctx.report.record(S, `run ${i + 1}`, 'warn', String(e.message).slice(0, 300)); }
  }
  if (!results.length) return ctx.report.record(S, 'PRs / Trends timings', 'fail', 'no run completed');
  const s = (x) => (x == null ? '?' : `${(x / 1000).toFixed(2)} s`);
  const m = (f) => median(results.map(f));
  ctx.report.table(`PRs and Trends, phone-sized Chromium, CPU throttled 4x, History already held (median of ${results.length})`,
    ['Step', 'tap -> shown', 'main-thread script'], [
      ['open PRs', s(m((r) => r.prs.ms)), s(m((r) => r.prs.script))],
      ['open Trends (grid + exercise chart)', s(m((r) => r.trends.ms)), s(m((r) => r.trends.script))],
      ['Trends range -> All', s(m((r) => r.all.ms)), s(m((r) => r.all.script))],
      ['Trends range -> back to 12wk (cached)', s(m((r) => r.back.ms)), s(m((r) => r.back.script))],
    ]);
  const kinds = [...new Set(results.flatMap((r) => r.responses.map((x) => x.kind)))];
  ctx.report.table('PRs / Trends responses during those steps (median per request)', ['Request', 'count per run', 'round trip', 'over the wire'],
    kinds.map((k) => {
      const all = results.flatMap((r) => r.responses.filter((x) => x.kind === k));
      return [k, (all.length / results.length).toFixed(1), `${Math.round(median(all.map((x) => x.ms)) ?? 0)} ms`, `${((median(all.map((x) => x.wire)) ?? 0) / 1024).toFixed(1)} KB`];
    }));
  ctx.report.record(S, 'PRs / Trends timings recorded', 'info', `${results.length} runs`);
}

// The app opened on a device holding its cache while the backend is scaled to zero (lower's
// min-replicas=0; production stays warm). Waits for zero replicas, which needs lower idle.
export async function coldStart(ctx, { maxWaitMin = 25 } = {}) {
  const S = 'cold-start';
  const prof = await openProfile('chromium');
  try {
    await login(prof.page, ctx.target.app, ctx.creds);
    await waitSynced(prof.page, String(ctx.api.personId), Math.min(ctx.seededWorkouts, 1000));
    await sleep(2500);
    const deadline = Date.now() + maxWaitMin * 60000;
    let replicas = replicaCount();
    if (replicas == null) return ctx.report.record(S, 'app opened on a cold backend', 'skip', 'az not available to see the replica count');
    while (replicas !== 0 && Date.now() < deadline) { log(`[cold-start] waiting for lower to scale to zero (replicas=${replicas})`); await sleep(30000); replicas = replicaCount(); }
    if (replicas !== 0) return ctx.report.record(S, 'app opened on a cold backend', 'skip', `lower never scaled to zero within ${maxWaitMin} min (something else is using it)`);
    const syncs = traceSyncs(prof.page, 'cold');
    const t0 = Date.now();
    await prof.page.goto(`${ctx.target.app}/app/history`);
    await prof.page.getByText(/×/).first().waitFor({ timeout: 180000 });
    const shown = Date.now() - t0;
    const firstSync = syncs[0] ? syncs[0].t - t0 : null;
    const people = (await ctx.api.ok('GET', '/api/people')).map((p) => String(p.id));
    const result = await converge(prof.page, ctx.api, people, 180000);
    ctx.report.record(S, 'History converged once the backend woke', result.ok ? 'pass' : 'fail', result.detail);
    ctx.report.record(S, 'time to first History content on a cold backend', 'info',
      `${(shown / 1000).toFixed(1)}s; the first History request left at ${firstSync == null ? '?' : (firstSync / 1000).toFixed(1) + 's'} (anything before it is app boot, not History)`);
  } catch (e) {
    ctx.report.record(S, 'app opened on a cold backend', 'fail', String(e.message).slice(0, 800));
  } finally { await prof.close(); }
}
