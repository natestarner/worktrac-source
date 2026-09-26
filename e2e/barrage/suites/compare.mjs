// LOCAL ONLY: the build under test against a baseline build (production's, by default) on the SAME
// data, served in turn on this worktree's frontend port against its local backend.
//
//  - outcome: History (every set, note and record badge), the PR celebration, Last time / prefill,
//    the PRs board and Trends must be IDENTICAL -- nothing a person sees may change underneath them.
//  - requests: how many History requests each everyday flow sends, side by side.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Api } from '../lib/api.mjs';
import { dismiss, goTab, playwright } from '../lib/browser.mjs';
import { REPO_ROOT, localTestSupportKey, log, sleep } from '../lib/config.mjs';

const EXERCISES = ['Barbell Bench Press', 'Barbell Back Squat', 'Barbell Row', 'Pull-up'];

// ── builds ────────────────────────────────────────────────────────────────────────────────────
export function buildBaseline(sha) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `barrage-baseline-${sha.slice(0, 7)}-`));
  log(`building baseline ${sha} in ${dir}`);
  execSync(`git archive ${sha} frontend | tar -x -C "${dir.replace(/\\/g, '/')}"`, { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' ? 'bash' : '/bin/sh' });
  const fe = path.join(dir, 'frontend');
  execSync('npm ci --no-audit --no-fund', { cwd: fe, stdio: 'ignore', shell: true });
  execSync('npm run build', { cwd: fe, stdio: 'ignore', shell: true });
  return { dir: fe, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function buildCurrent() {
  const fe = path.join(REPO_ROOT, 'frontend');
  if (!existsSync(path.join(fe, 'node_modules'))) execSync('npm ci --no-audit --no-fund', { cwd: fe, stdio: 'ignore', shell: true });
  log('building the frontend under test');
  execSync('npm run build', { cwd: fe, stdio: 'ignore', shell: true });
  return { dir: fe, cleanup: () => {} };
}

async function serve(dir, target) {
  const child = spawn(process.execPath, [path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--strictPort'], {
    cwd: dir, env: { ...process.env, FRONTEND_PORT: target.frontendPort, VITE_BACKEND_ORIGIN: target.api }, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i += 1) {
    if (await fetch(target.app).then((r) => r.ok, () => false)) return child;
    await sleep(500);
  }
  child.kill();
  throw new Error(`vite preview never answered on ${target.app} -- is the dev server still holding the port?`);
}

// ── data: two years, every other day, progressive overload with deloads, so every record type
//    falls all through History, in every month, including bodyweight pull-ups ─────────────────
async function seedAbHousehold(target) {
  const key = localTestSupportKey();
  const email = `huddle+e2e-barrage-ab-${Date.now()}@starner.co`;
  const password = 'barrage-ab-password-1';
  const anon = new Api(target.api, { testSupportKey: key });
  await anon.ok('POST', '/api/auth/register', { email, password, personName: 'Nate' });
  const { code } = await anon.ok('GET', `/api/auth/test/pending-code?email=${encodeURIComponent(email)}`);
  await anon.ok('POST', '/api/auth/confirm-email', { email, code });
  await anon.ok('POST', `/api/auth/test/billing-plan?email=${encodeURIComponent(email)}&plan=PLUS`);
  const api = await Api.login(target.api, email, password);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rows = [];
  const start = new Date(); start.setUTCFullYear(start.getUTCFullYear() - 2);
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 3);
  for (let d = new Date(start), i = 0; d < end; d.setUTCDate(d.getUTCDate() + 2), i += 1) {
    const day = d.toISOString().slice(0, 10);
    const cycle = (i % 21) / 21;
    const base = 1 + i / 400;
    for (const n of i % 2 === 0 ? ['Barbell Bench Press', 'Barbell Row', 'Pull-up'] : ['Barbell Back Squat', 'Barbell Bench Press']) {
      const startW = { 'Barbell Bench Press': 135, 'Barbell Back Squat': 185, 'Barbell Row': 115, 'Pull-up': 0 }[n];
      for (let k = 0, sets = 2 + Math.floor(rnd() * 3); k < sets; k += 1) {
        const w = startW === 0 ? 0 : Math.round((startW * base * (0.85 + 0.2 * cycle)) / 5) * 5;
        const reps = startW === 0 ? 5 + Math.floor(rnd() * 8 * base) : 3 + Math.floor(rnd() * 6);
        rows.push(`${n},${day},18:00:00,${w},lb,${reps}`);
      }
    }
  }
  await api.ok('POST', `/api/people/${api.personId}/import`, { csv: `Exercise,Date,Time,Weight,Unit,Reps\n${rows.join('\n')}\n`, filename: 'ab.csv' });
  const history = await api.truth();
  const old = history[history.length - 5];
  await api.ok('PUT', `/api/sessions/${old.id}/exercises/${old.entries[0].exerciseId}/note`, { note: 'Barrage A/B note' });
  return { email, password, api };
}

// ── what a person sees ────────────────────────────────────────────────────────────────────────
async function capture(target, creds, { offline }) {
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  const out = {};
  const toExercise = async (name) => {
    const picker = page.getByPlaceholder('Search all exercises');
    await picker.or(page.getByRole('button', { name: /All exercises/ })).first().waitFor();
    if (!(await picker.isVisible())) { await page.getByRole('button', { name: /All exercises/ }).first().click(); await picker.waitFor(); }
    await picker.fill(name);
    await page.getByRole('button', { name, exact: true }).first().click();
    await page.getByRole('button', { name: 'Log set' }).waitFor();
    await sleep(1500);
  };
  const history = () => page.evaluate(() => {
    const norm = (x) => (x || '').replace(/\s+/g, '');
    return [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Edit').map((e) => {
      let block = e.parentElement;
      while (block && !block.querySelector('button[aria-label^="View options for"]')) block = block.parentElement;
      if (!block) return null;
      return {
        header: norm(e.parentElement.firstElementChild?.textContent),
        names: [...block.querySelectorAll('button[aria-label^="View options for"]')].map((b) => b.getAttribute('aria-label').slice(17)),
        sets: [...block.querySelectorAll('*')].filter((x) => x.children.length === 0 && /×/.test(x.textContent)).map((x) => norm(x.textContent)),
        labels: [...block.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')).filter((a) => !/^View options for/.test(a)),
        note: /Barrage A\/B note/.test(block.textContent),
      };
    }).filter(Boolean);
  });
  const cards = () => page.evaluate(() => {
    const found = {};
    for (const el of document.querySelectorAll('*')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      const m = own.match(/^(Last time|Best)/i);
      if (m) found[m[1]] = (el.parentElement?.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return { found, steppers: [...document.querySelectorAll('.stepper-value')].map((i) => i.value) };
  });
  const main = () => page.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').trim());
  try {
    await page.goto(`${target.app}/login`);
    await page.getByPlaceholder('Email', { exact: true }).fill(creds.email);
    await page.getByPlaceholder('Password', { exact: true }).fill(creds.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/app\//);
    await sleep(3000);
    await dismiss(page);
    await goTab(page, 'History');
    await page.getByText(/×/).first().waitFor();
    await sleep(2500);
    out.history = await history();
    out.log = {};
    for (const ex of EXERCISES) { await goTab(page, 'Log'); await toExercise(ex); out.log[ex] = await cards(); }
    await goTab(page, 'PRs'); await sleep(2500); out.prs = await main();
    await goTab(page, 'Trends'); await sleep(4000); out.trends = await main();
    // A deliberate record: well above the best.
    await goTab(page, 'Log'); await toExercise('Barbell Bench Press');
    const weight = page.locator('.stepper-row').filter({ hasText: 'Weight' }).locator('.stepper-value');
    const reps = page.locator('.stepper-row').filter({ hasText: 'Reps' }).locator('.stepper-value');
    await weight.fill('500'); await weight.press('Enter'); await reps.fill('5'); await reps.press('Enter');
    await page.getByRole('button', { name: 'Log set' }).click();
    const pr = page.getByText('New PR!');
    await pr.waitFor({ timeout: 10000 }).catch(() => {});
    const text = await main();
    out.celebration = (text.match(/New PR!.{0,120}/) || ['NO CELEBRATION'])[0];
    if (await pr.isVisible().catch(() => false)) await pr.click({ force: true });
    await sleep(3000);
    out.afterRecordCard = await cards();
    await goTab(page, 'History'); await sleep(3000);
    out.afterRecordHistory = (await history()).slice(0, 2).map(({ names, sets, labels }) => ({ names, sets, labels }));
    if (offline) {
      await context.setOffline(true);
      out.offlineLog = {};
      for (const ex of EXERCISES) { await goTab(page, 'Log'); await toExercise(ex); out.offlineLog[ex] = await cards(); }
      await goTab(page, 'History'); await sleep(2500);
      out.offlineHistory = (await history()).map(({ names, sets, labels }) => ({ names, sets, labels }));
      await context.setOffline(false);
    }
    out.errors = errors;
    return out;
  } finally {
    await browser.close();
  }
}

async function undoRecord(api) {
  const live = (await api.truth()).find((s) => s.endedAt === null);
  if (live) {
    for (const e of live.entries) for (const set of await api.setsOf(live.id, e.exerciseId)) await api.req('DELETE', `/api/sets/${set.id}`);
  }
  await api.req('POST', `/api/people/${api.personId}/sessions/live/end`);
}

export async function outcome(ctx, baseline, current) {
  const S = 'compare:outcome';
  const household = await seedAbHousehold(ctx.target);
  let a; let b;
  let server = await serve(baseline.dir, ctx.target);
  try { a = await capture(ctx.target, household, { offline: false }); } finally { server.kill(); await sleep(1500); }
  await undoRecord(household.api);
  server = await serve(current.dir, ctx.target);
  try { b = await capture(ctx.target, household, { offline: true }); } finally { server.kill(); await sleep(1500); }
  await undoRecord(household.api);
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const badges = (h) => h.reduce((n, blk) => n + blk.labels.length, 0);
  ctx.report.record(S, `History: every workout, set and note (${a.history.length} workouts)`, same(a.history.map(({ header, names, sets, note }) => ({ header, names, sets, note })), b.history.map(({ header, names, sets, note }) => ({ header, names, sets, note }))) ? 'pass' : 'fail', `${a.history.length} vs ${b.history.length}`);
  ctx.report.record(S, `History: every record badge (${badges(a.history)})`, same(a.history.map((x) => x.labels), b.history.map((x) => x.labels)) ? 'pass' : 'fail', `${badges(a.history)} vs ${badges(b.history)}`);
  ctx.report.record(S, 'PR celebration on a deliberate record', same(a.celebration, b.celebration) && !/NO CELEBRATION/.test(b.celebration) ? 'pass' : 'fail', `baseline: ${a.celebration}\nunder test: ${b.celebration}`);
  ctx.report.record(S, 'the record\'s badges in History', same(a.afterRecordHistory, b.afterRecordHistory) ? 'pass' : 'fail', JSON.stringify(b.afterRecordHistory[0]?.labels ?? []));
  ctx.report.record(S, `Last time and the prefill (${EXERCISES.length} exercises)`, same(a.log, b.log) ? 'pass' : 'fail', same(a.log, b.log) ? '' : `baseline ${JSON.stringify(a.log).slice(0, 600)}\nunder test ${JSON.stringify(b.log).slice(0, 600)}`);
  ctx.report.record(S, 'Log screen right after the record', same(a.afterRecordCard, b.afterRecordCard) ? 'pass' : 'fail', JSON.stringify(b.afterRecordCard).slice(0, 300));
  ctx.report.record(S, 'PRs board', same(a.prs, b.prs) ? 'pass' : 'fail', same(a.prs, b.prs) ? '' : 'the board text differs');
  ctx.report.record(S, 'Trends', same(a.trends, b.trends) ? 'pass' : 'fail', same(a.trends, b.trends) ? '' : 'the Trends text differs');
  ctx.report.record(S, 'under test, offline: Last time equals online', EXERCISES.every((e) => same(b.offlineLog[e].found, b.afterRecordCard.found) || same(b.offlineLog[e].found, b.log[e].found)) ? 'pass' : 'fail', '');
  ctx.report.record(S, 'under test, offline: History equals online', same(b.offlineHistory.slice(1), b.history.map(({ names, sets, labels }) => ({ names, sets, labels }))) ? 'pass' : 'fail', `${b.offlineHistory.length} blocks offline`);
  ctx.report.record(S, 'no page errors in either build', a.errors.length + b.errors.length === 0 ? 'pass' : 'warn', [...a.errors, ...b.errors].join('\n'));
}

// ── History requests per everyday flow ────────────────────────────────────────────────────────
async function countFlows(target, creds) {
  const browser = await playwright.chromium.launch();
  const ctxt = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let page = await ctxt.newPage();
  const sent = [];
  const hook = (p) => p.on('request', (r) => {
    const u = new URL(r.url());
    if (!/\/api\/people\/\d+\/history(\/sync)?$/.test(u.pathname)) return;
    const b = r.postData() ? JSON.parse(r.postData()) : null;
    sent.push(b ? (b.sessions ? 'scoped' : Object.keys(b.have || {}).length ? 'ordinary' : 'full') : 'full-GET');
  });
  hook(page);
  const flows = [];
  const count = async (name, fn, settle = 4000) => {
    const from = sent.length;
    await fn();
    await sleep(settle);
    const got = sent.slice(from);
    flows.push([name, got.length, got.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})]);
  };
  const toExercise = async (name) => {
    const picker = page.getByPlaceholder('Search all exercises');
    await picker.or(page.getByRole('button', { name: /All exercises/ })).first().waitFor();
    if (!(await picker.isVisible())) { await page.getByRole('button', { name: /All exercises/ }).first().click(); await picker.waitFor(); }
    await picker.fill(name); await page.getByRole('button', { name, exact: true }).first().click();
    await page.getByRole('button', { name: 'Log set' }).waitFor();
  };
  const logSet = async () => { await page.getByRole('button', { name: 'Log set' }).click(); await sleep(400); await dismiss(page); };
  try {
    await count('sign in on a new device', async () => {
      await page.goto(`${target.app}/login`);
      await page.getByPlaceholder('Email', { exact: true }).fill(creds.email);
      await page.getByPlaceholder('Password', { exact: true }).fill(creds.password);
      await page.getByRole('button', { name: 'Log in' }).click();
      await page.waitForURL(/\/app\//); await sleep(2500); await dismiss(page);
    }, 6000);
    await count('open History', () => goTab(page, 'History'));
    await count('reopen the app', async () => { await page.reload(); await page.getByText(/×/).first().waitFor(); });
    await count('first set (starts a workout)', async () => { await goTab(page, 'Log'); await toExercise('Barbell Bench Press'); await logSet(); });
    await count('each further set', () => logSet());
    await count('back to the session list, next exercise', async () => { await page.getByRole('button', { name: /All exercises/ }).first().click(); await sleep(800); await toExercise('Barbell Row'); });
    await count('reopen mid-workout', async () => { await page.reload(); await page.getByRole('button', { name: 'Log set' }).waitFor(); });
    await count('offline set, app closed, reopened online', async () => {
      await ctxt.setOffline(true); await logSet(); await sleep(1500);
      const next = await ctxt.newPage(); await page.close(); page = next; hook(page);
      await ctxt.setOffline(false);
      await page.goto(`${target.app}/app/log`); await page.getByRole('button', { name: /Log set|All exercises/ }).first().waitFor();
    }, 6000);
    await count('end the workout', async () => {
      await page.getByRole('button', { name: 'End workout' }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();
    });
    return flows;
  } finally { await browser.close(); }
}

export async function requests(ctx, baseline, current) {
  const S = 'compare:requests';
  const results = {};
  for (const [label, build] of [['baseline', baseline], ['under test', current]]) {
    const household = await seedAbHousehold(ctx.target);
    const server = await serve(build.dir, ctx.target);
    try { results[label] = await countFlows(ctx.target, household); } finally { server.kill(); await sleep(1500); }
  }
  const fmt = (f) => `${f[1]} ${JSON.stringify(f[2])}`;
  ctx.report.table('History requests per everyday flow (every request sent counts, even an abandoned one)', ['Flow', 'baseline', 'under test'],
    results['under test'].map((f, i) => [f[0], results.baseline[i] ? fmt(results.baseline[i]) : '?', fmt(f)]));
  // What the History work promises (docs/architecture/history-sync.md): one light request per
  // everyday flow, one full sync on sign-in, and never more requests than the baseline + 1.
  const byName = Object.fromEntries(results['under test'].map((f) => [f[0], f]));
  const expect = [
    ['sign in on a new device', (f) => f[2].full === 1 && f[1] === 1],
    ['reopen the app', (f) => f[1] <= 1 && !f[2].full],
    ['each further set', (f) => f[1] === 1 && f[2].scoped === 1],
  ];
  for (const [name, ok] of expect) {
    const f = byName[name];
    ctx.report.record(S, `${name}: ${name.startsWith('sign in') ? 'exactly one full sync' : name.startsWith('each') ? 'one scoped sync' : 'one light check, no full download'}`, f && ok(f) ? 'pass' : 'fail', f ? fmt(f) : 'flow did not run');
  }
  const worse = results['under test'].filter((f, i) => results.baseline[i] && f[1] > results.baseline[i][1] + 1);
  ctx.report.record(S, 'no flow sends more than one extra request over the baseline', worse.length ? 'fail' : 'pass', worse.map(fmt).join('; '));
}
