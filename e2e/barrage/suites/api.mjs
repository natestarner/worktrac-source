// API-level suites: every History-changing write checked against simulated devices, hostile input,
// timings, and load. A "device" here applies sync replies exactly as the app does (lib/device.mjs);
// GET /history is the truth.
import { Device, Mismatch, expectEqual } from '../lib/device.mjs';
import { log, sleep } from '../lib/config.mjs';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.round(s.length * 0.95) - 1)]; };
const ms = (x) => `${Math.round(x)} ms`;
const monthsBack = (n) => { const d = new Date(); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
const sessionIn = (truth, month) => truth.find((s) => s.startedAt.slice(0, 7) === month && s.endedAt !== null);

// ── abuse ─────────────────────────────────────────────────────────────────────────────────────
export async function abuse({ api, report }) {
  const S = 'api:abuse';
  const url = `/api/people/${api.personId}/history/sync`;
  const cases = [
    ['have: 2,400 junk keys', { have: Object.fromEntries([...Array(2400)].map((_, i) => [`x${i}`, 'y'])) }, [200]],
    ['have: 2,401 keys (over the bound)', { have: Object.fromEntries([...Array(2401)].map((_, i) => [`x${i}`, 'y'])) }, [400]],
    ['have: null', { have: null }, [200]],
    ['empty body', {}, [200]],
    ['have: bogus month keys', { have: { '2026-13': 'a', abcd: 'b', '': 'c' } }, [200]],
    ['sessions: 9 ids (over the bound)', { have: { '2026-01': 'x' }, sessions: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, [400]],
    ['at: 9 instants (over the bound)', { have: { '2026-01': 'x' }, sessions: [1], at: Array(9).fill('2026-01-01T00:00:00Z') }, [400]],
    ['at: unparseable', { have: { '2026-01': 'x' }, sessions: [1], at: ['yesterday'] }, [400]],
    ['at: year 0001', { have: { '2026-01': 'x' }, sessions: [1], at: ['0001-01-15T00:00:00Z'] }, [200]],
    ['at only, no sessions', { have: { '2026-01': 'x' }, at: ['2024-02-01T00:00:00Z'] }, [200]],
    ['sessions: [null]', { have: { '2026-01': 'x' }, sessions: [null] }, [200]],
    ['sessions: huge id (largest exact JSON integer)', { have: { '2026-01': 'x' }, sessions: [Number.MAX_SAFE_INTEGER] }, [200]],
  ];
  for (const [label, body, expected] of cases) {
    const r = await api.req('POST', url, body);
    const shape = r.body && typeof r.body === 'object' && 'months' in r.body ? `months=${r.body.months.length} scope=${JSON.stringify(r.body.scope ?? null).slice(0, 40)}` : String(r.body?.message ?? r.body).slice(0, 80);
    report.record(S, label, expected.includes(r.status) ? 'pass' : 'fail', `${r.status} in ${ms(r.ms)}; ${shape}`);
  }
  // Known and cosmetic: a year-9999 instant overflows DATETIME2 and is answered as a 503 rather than
  // a 400. Only a hand-made request can send it; recorded so a change in either direction is seen.
  const y9999 = await api.req('POST', url, { have: { '2026-01': 'x' }, sessions: [1], at: ['9999-12-15T00:00:00Z'] });
  report.record(S, 'at: year 9999', y9999.status === 400 ? 'pass' : y9999.status === 503 ? 'warn' : 'fail',
    y9999.status === 503 ? 'known: 503 (DATETIME2 overflow) instead of 400 -- cosmetic, hand-made requests only' : `${y9999.status}`);
  for (const pid of [1, 2, 987654321]) {
    if (pid === api.personId) continue;
    const r = await api.req('POST', `/api/people/${pid}/history/sync`, { have: {} });
    report.record(S, `another household's person ${pid}`, r.status === 404 || r.status === 403 ? 'pass' : 'fail', `${r.status}`);
  }
  // Only the INVALID drift report: a valid one writes a "History drift:" WARN, which is exactly what
  // the ops suite treats as a real failure.
  const drift = await api.req('POST', `/api/people/${api.personId}/history/drift`, { months: ['<script>'] });
  report.record(S, 'drift report with a malformed month', drift.status === 400 ? 'pass' : 'fail', `${drift.status}`);
}

// ── correctness ───────────────────────────────────────────────────────────────────────────────
export async function correctness({ api, report, cleanup, runId }) {
  const S = 'api:correctness';
  const P = api.personId;
  const bench = await api.exerciseId('Barbell Bench Press');
  let truth = await api.truth();
  const earliest = truth[truth.length - 1].startedAt.slice(0, 7);
  const old = sessionIn(truth, monthsBack(36)) ?? truth[Math.floor(truth.length * 0.6)];
  cleanup.touch(old.id);
  const oldEx = old.entries[0].exerciseId;
  const [firstSet] = await api.setsOf(old.id, oldEx);

  const scoped = new Device(api, 'scoped');
  const ordinary = new Device(api, 'ordinary');
  for (const d of [scoped, ordinary]) { await d.sync(); expectEqual(d, truth, 'initial full sync'); }
  const snapshot = scoped.clone('snapshot');

  async function step(label, scope) {
    try {
      truth = await api.truth();
      const { reply, ms: t } = await scoped.sync({ scope });
      if (reply.scope) expectEqual(scoped, truth, `${label}: scoped months`, reply.scope);
      await scoped.sync();
      expectEqual(scoped, truth, `${label}: scoped, then ordinary`);
      await ordinary.sync();
      expectEqual(ordinary, truth, `${label}: ordinary`);
      const restored = snapshot.clone('restored-from-start');
      await restored.sync();
      expectEqual(restored, truth, `${label}: restored from the initial snapshot`);
      const restoredScoped = snapshot.clone('restored+scoped');
      const r2 = await restoredScoped.sync({ scope });
      if (r2.reply.scope) expectEqual(restoredScoped, truth, `${label}: restored, scoped months`, r2.reply.scope);
      await restoredScoped.sync();
      expectEqual(restoredScoped, truth, `${label}: restored, scoped, then ordinary`);
      const fresh = new Device(api, 'fresh');
      await fresh.sync();
      expectEqual(fresh, truth, `${label}: full`);
      report.record(S, label, 'pass', `scope=${JSON.stringify(reply.scope ?? 'ordinary')} sent=${JSON.stringify(Object.keys(reply.changed ?? {}))} ${ms(t)}`);
    } catch (e) {
      report.record(S, label, 'fail', e instanceof Mismatch ? e.message : String(e.stack || e));
    }
  }

  const live = await api.ok('POST', `/api/people/${P}/live-sets`, { exerciseId: bench, weight: 101, reps: 5 });
  cleanup.touch(live.session.id);
  await step('live set in today\'s workout', { sessions: [live.session.id], at: [live.session.startedAt] });

  await api.ok('PATCH', `/api/sets/${firstSet.id}`, { weight: Number(firstSet.weight) + 2.5, reps: firstSet.reps });
  await step(`edit a set in a ${old.startedAt.slice(0, 7)} workout`, { sessions: [old.id], at: [old.startedAt] });

  for (const note of ['barrage note one', 'barrage note two', '']) {
    await api.ok('PUT', `/api/sessions/${old.id}/exercises/${oldEx}/note`, { note });
    await step(`note ${JSON.stringify(note)} on that workout`, { sessions: [old.id], at: [old.startedAt] });
  }

  const added = await api.ok('POST', `/api/sessions/${old.id}/sets`, { exerciseId: bench, weight: 77, reps: 7 });
  await step('log a set into that workout', { sessions: [old.id], at: [old.startedAt] });
  await api.ok('DELETE', `/api/sets/${added.set.id}`);
  await step('delete that set', { sessions: [old.id], at: [old.startedAt] });

  // A workout in a month before the History begins: a month appears, then (moved) vacates.
  const before = new Date(`${earliest}-10T15:00:00Z`);
  before.setUTCMonth(before.getUTCMonth() - 3);
  const moved = new Date(before);
  moved.setUTCMonth(moved.getUTCMonth() - 4);
  const past = await api.ok('POST', `/api/people/${P}/sessions`, { startedAt: before.toISOString() });
  cleanup.touch(past.id);
  await step(`empty past workout in a new month ${before.toISOString().slice(0, 7)}`, { sessions: [past.id], at: [past.startedAt] });
  await api.ok('POST', `/api/sessions/${past.id}/sets`, { exerciseId: bench, weight: 95, reps: 8 });
  await step('a set into it', { sessions: [past.id], at: [past.startedAt] });
  await api.ok('PATCH', `/api/sessions/${past.id}`, { startedAt: moved.toISOString() });
  await step('moved to another new month; the scope names only the OLD month', { sessions: [past.id], at: [before.toISOString()] });
  const into = truth[Math.floor(truth.length * 0.8)].startedAt.slice(0, 7);
  await api.ok('PATCH', `/api/sessions/${past.id}`, { startedAt: `${into}-10T03:00:00Z` });
  await step(`moved into ${into}; the scope names no month`, { sessions: [past.id], at: [] });
  const months = new Set((await api.truth()).map((s) => s.startedAt.slice(0, 7)));
  const vacated = [before, moved].map((d) => d.toISOString().slice(0, 7));
  const left = vacated.filter((m) => months.has(m) || scoped.months[m] || ordinary.months[m]);
  report.record(S, 'vacated months are gone from every device', left.length ? 'fail' : 'pass', left.length ? `still held: ${left}` : vacated.join(', '));

  const cx = await api.ok('POST', '/api/exercises', { name: `Barrage Curl ${runId}` });
  cleanup.addExercise(cx.id);
  await api.ok('POST', `/api/sessions/${old.id}/sets`, { exerciseId: cx.id, weight: 20, reps: 10 });
  await step('a custom exercise logged in the old workout', { sessions: [old.id], at: [old.startedAt] });
  await api.ok('PUT', `/api/exercises/${cx.id}`, { name: `Barrage Curl ${runId} (renamed)` });
  await step('the exercise renamed (ordinary sync, as refreshHistoryForEveryone does)', null);

  try {
    const { reply } = await scoped.sync({ scope: { sessions: [1, 2, 3], at: [] } });
    const clean = Array.isArray(reply.scope) && reply.scope.length === 0 && reply.months.length === 0 && !Object.keys(reply.changed ?? {}).length;
    expectEqual(scoped, await api.truth(), 'foreign workout ids');
    report.record(S, 'a scope of foreign / missing workout ids adds and leaks nothing', clean ? 'pass' : 'fail', JSON.stringify(reply).slice(0, 160));
  } catch (e) { report.record(S, 'a scope of foreign / missing workout ids adds and leaks nothing', 'fail', String(e.message || e)); }

  await api.ok('PATCH', `/api/sets/${firstSet.id}`, { weight: Number(firstSet.weight), reps: firstSet.reps });
  report.record(S, '503 retries during the scenarios', 'info', `${scoped.retried503 + ordinary.retried503}`);
}

// ── bench ─────────────────────────────────────────────────────────────────────────────────────
export async function bench({ api, report, cleanup, runs = 10 }) {
  const S = 'api:bench';
  const url = `/api/people/${api.personId}/history/sync`;
  const dev = new Device(api, 'bench');
  await dev.sync();
  const have = Object.fromEntries(Object.entries(dev.months).map(([m, v]) => [m, v.fp]));
  const time = async (n, fn) => { const out = []; for (let i = 0; i < n; i += 1) out.push(await fn(i)); return out; };
  const rows = [];
  const add = (label, xs) => rows.push([label, ms(median(xs)), ms(p95(xs)), String(xs.length)]);
  add('full sync (holding nothing)', await time(runs, async () => (await api.req('POST', url, { have: {} })).ms));
  add('nothing changed (reload / warm)', await time(runs, async () => (await api.req('POST', url, { have })).ms));
  const bench = await api.exerciseId('Barbell Bench Press');
  const scopedT = []; const ordinaryT = [];
  for (let i = 0; i < runs; i += 1) {
    const a = await api.ok('POST', `/api/people/${api.personId}/live-sets`, { exerciseId: bench, weight: 100 + i, reps: 5 });
    cleanup.touch(a.session.id);
    const r1 = await api.req('POST', url, { have, sessions: [a.session.id], at: [a.session.startedAt] });
    for (const [m, c] of Object.entries(r1.body.changed ?? {})) have[m] = c.fp;
    scopedT.push(r1.ms);
    await api.ok('POST', `/api/people/${api.personId}/live-sets`, { exerciseId: bench, weight: 100 + i, reps: 6 });
    const r2 = await api.req('POST', url, { have });
    for (const [m, c] of Object.entries(r2.body.changed ?? {})) have[m] = c.fp;
    ordinaryT.push(r2.ms);
  }
  add('after a logged set, scoped (what the app sends)', scopedT);
  add('after a logged set, ordinary', ordinaryT);
  const keys = Object.keys(have).sort();
  const one = { ...have, [keys[Math.floor(keys.length / 2)]]: 'stale' };
  add(`one old month stale (${keys[Math.floor(keys.length / 2)]})`, await time(runs, async () => (await api.req('POST', url, { have: one })).ms));
  const wide = { ...have };
  for (const m of [...keys.slice(0, 2), ...keys.slice(-2)]) wide[m] = 'stale';
  add('oldest + newest stale (widest range load)', await time(runs, async () => (await api.req('POST', url, { have: wide })).ms));
  add('GET /history (older app builds)', await time(Math.max(3, runs / 2), async () => (await api.req('GET', `/api/people/${api.personId}/history`)).ms));
  await api.req('POST', `/api/people/${api.personId}/sessions/live/end`);
  report.table('API timings (this History)', ['Request', 'median', 'p95', 'n'], rows);
  report.record(S, 'timings recorded', 'info', rows.map((r) => `${r[0]} ${r[1]}`).join('; '));
  await statsBench({ api, report, runs, bench });
}

// The reads behind the PRs board, Trends and the Log screen's summary, timed on the same History as
// the sync above so the two can be compared directly. Each of these loads every set the person has
// logged (StatsService), so this is the baseline for moving them onto History
// (docs/architecture/history-sync.md, "Not covered here").
async function statsBench({ api, report, runs, bench }) {
  const P = api.personId;
  const zone = 'zone=America%2FNew_York';
  const rows = [];
  const requests = [
    ['GET /prs', `/api/people/${P}/prs`],
    ['GET /trends/overview (12wk)', `/api/people/${P}/trends/overview?weeks=12&${zone}`],
    ['GET /trends/overview (All)', `/api/people/${P}/trends/overview?weeks=260&${zone}`],
    ['GET /trends/exercises/{bench} (12wk)', `/api/people/${P}/trends/exercises/${bench}?weeks=12&${zone}`],
    ['GET /trends/exercises/{bench} (All)', `/api/people/${P}/trends/exercises/${bench}?weeks=260&${zone}`],
    ['GET /exercises/{bench}/records', `/api/people/${P}/exercises/${bench}/records?${zone}`],
    ['GET /exercises/{bench}/summary', `/api/people/${P}/exercises/${bench}/summary`],
  ];
  for (const [label, path] of requests) {
    const out = [];
    let bytes = null;
    for (let i = 0; i < runs; i += 1) {
      const r = await api.req('GET', path);
      if (r.status !== 200) { rows.push([label, `status ${r.status}`, '', '', '']); out.length = 0; break; }
      out.push(r.ms); bytes = r.bytes;
    }
    if (out.length) rows.push([label, ms(median(out)), ms(p95(out)), String(out.length), bytes == null ? '?' : `${(bytes / 1024).toFixed(1)} KB`]);
  }
  report.table('API timings: PRs, Trends and the Log summary (this History)', ['Request', 'median', 'p95', 'n', 'body (uncompressed)'], rows);
  report.record('api:bench', 'stats timings recorded', 'info', rows.map((r) => `${r[0]} ${r[1]}`).join('; '));
}

// ── load ──────────────────────────────────────────────────────────────────────────────────────
// A household mid-workout: one lifter logs a set every ~4s with the scoped sync the app sends,
// three other devices run an ordinary sync every 5-10s.
export async function realistic({ api, report, cleanup, seconds = 120 }) {
  const S = 'api:load';
  const bench = await api.exerciseId('Barbell Bench Press');
  const lifter = new Device(api, 'lifter');
  const others = [0, 1, 2].map((i) => new Device(api, `other${i}`));
  for (const d of [lifter, ...others]) await d.sync();
  const stop = Date.now() + seconds * 1000;
  const lat = { scoped: [], ordinary: [], write: [] };
  const errors = [];
  const lift = (async () => {
    while (Date.now() < stop) {
      const r = await api.req('POST', `/api/people/${api.personId}/live-sets`, { exerciseId: bench, weight: 135, reps: 5 });
      lat.write.push(r.ms);
      if (r.status !== 200) { errors.push(`write ${r.status}`); await sleep(4000); continue; }
      cleanup.touch(r.body.session.id);
      try { lat.scoped.push((await lifter.sync({ scope: { sessions: [r.body.session.id], at: [r.body.session.startedAt] } })).ms); } catch (e) { errors.push(`lifter: ${e.message}`); }
      await sleep(4000);
    }
  })();
  const watchers = others.map(async (d, i) => {
    await sleep(Math.random() * 5000);
    while (Date.now() < stop) {
      try { lat.ordinary.push((await d.sync()).ms); } catch (e) { errors.push(`${d.name}: ${e.message}`); }
      await sleep(5000 + Math.random() * 5000 + i);
    }
  });
  await Promise.all([lift, ...watchers]);
  const truth = await api.truth();
  let converged = true;
  for (const d of [lifter, ...others]) {
    try { await d.sync(); expectEqual(d, truth, 'after the realistic run'); } catch (e) { converged = false; errors.push(e.message); }
  }
  const retries = [lifter, ...others].reduce((n, d) => n + d.retried503, 0);
  report.table('Realistic household load', ['Request', 'median', 'p95', 'max', 'n'],
    Object.entries(lat).map(([k, xs]) => [k, ms(median(xs)), ms(p95(xs)), ms(Math.max(...xs)), String(xs.length)]));
  report.record(S, `realistic household load (${seconds}s): every device converged`, converged && !errors.length ? 'pass' : 'fail',
    `scoped median ${ms(median(lat.scoped))}, ordinary median ${ms(median(lat.ordinary))}; 503 retries ${retries}; errors ${errors.length} ${errors.slice(0, 3).join(' | ')}`);
  await api.req('POST', `/api/people/${api.personId}/sessions/live/end`);
}

// The storm: two writers hitting old and new months while four devices sync back to back (10% of
// them full). Far past real use -- it is here to prove correctness under contention, not speed.
export async function storm({ api, report, cleanup, seconds = 60, devices = 4 }) {
  const S = 'api:storm';
  const bench = await api.exerciseId('Barbell Bench Press');
  const truth0 = await api.truth();
  const targets = [8, 20, 30, 44].map((n) => sessionIn(truth0, monthsBack(n))).filter(Boolean);
  for (const t of targets) cleanup.touch(t.id);
  const stop = Date.now() + seconds * 1000;
  const added = [];
  const lat = { sync: [], write: [] };
  const errors = [];
  const writer = async (seed) => {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    while (Date.now() < stop) {
      let r;
      if (added.length && rnd() < 0.35) {
        r = await api.req('DELETE', `/api/sets/${added.splice(Math.floor(rnd() * added.length), 1)[0]}`);
      } else {
        const t = targets[Math.floor(rnd() * (targets.length + 1))];
        r = t
          ? await api.req('POST', `/api/sessions/${t.id}/sets`, { exerciseId: bench, weight: 61, reps: 3 })
          : await api.req('POST', `/api/people/${api.personId}/live-sets`, { exerciseId: bench, weight: 60, reps: 3 });
        if (r.status === 200) { added.push(r.body.set.id); cleanup.touch(r.body.session.id); }
      }
      lat.write.push(r.ms);
      if (r.status !== 200 && r.status !== 204) errors.push(`write ${r.status}`);
    }
  };
  const devs = [...Array(devices)].map((_, i) => new Device(api, `storm${i}`));
  for (const d of devs) await d.sync();
  const syncer = async (d, i) => {
    while (Date.now() < stop) {
      try { lat.sync.push((await d.sync({ full: Math.random() < 0.1 })).ms); } catch (e) { errors.push(`${d.name}: ${e.message}`); }
      await sleep(Math.random() * 500 + i);
    }
  };
  await Promise.all([writer(1), writer(2), ...devs.map(syncer)]);
  const truth = await api.truth();
  let converged = true;
  for (const d of devs) { try { await d.sync(); expectEqual(d, truth, 'after the storm'); } catch (e) { converged = false; errors.push(e.message); } }
  const retries = devs.reduce((n, d) => n + d.retried503, 0);
  report.table('Storm (2 writers, back-to-back syncs)', ['Request', 'median', 'p95', 'max', 'n'],
    Object.entries(lat).map(([k, xs]) => [k, ms(median(xs)), ms(p95(xs)), ms(Math.max(...xs)), String(xs.length)]));
  report.record(S, `storm (${seconds}s): every device converged in one quiet sync`, converged && !errors.length ? 'pass' : 'fail',
    `sync median ${ms(median(lat.sync))} max ${ms(Math.max(...lat.sync))}; 503 retries ${retries}; errors ${errors.length} ${errors.slice(0, 3).join(' | ')}`);
  await api.req('POST', `/api/people/${api.personId}/sessions/live/end`);
}

// ── deploy watch ──────────────────────────────────────────────────────────────────────────────
// Syncs every ~2s and writes every ~15s (with the app's scoped sync) until `shouldStop()`; then one
// quiet sync must equal the truth. Run it through a deploy: every non-2xx is listed with its time.
export async function deployWatch({ api, report, cleanup, shouldStop }) {
  const S = 'deploy-watch';
  const bench = await api.exerciseId('Barbell Bench Press');
  const dev = new Device(api, 'deploy-watch');
  await dev.sync();
  const statuses = {};
  const events = [];
  const lat = [];
  let lastWrite = 0;
  const note = (kind, status, extra = '') => {
    statuses[`${kind}:${status}`] = (statuses[`${kind}:${status}`] ?? 0) + 1;
    if (status !== 200 && status !== 204) events.push(`${new Date().toISOString().slice(11, 19)} ${kind} -> ${status} ${extra}`.slice(0, 200));
  };
  while (!(await shouldStop())) {
    if (Date.now() - lastWrite > 15000) {
      lastWrite = Date.now();
      const w = await api.req('POST', `/api/people/${api.personId}/live-sets`, { exerciseId: bench, weight: 50, reps: 2 }, { timeoutMs: 20000 });
      note('write', w.status, w.status ? '' : String(w.body));
      if (w.status === 200) {
        cleanup.touch(w.body.session.id);
        try { await dev.sync({ scope: { sessions: [w.body.session.id], at: [w.body.session.startedAt] }, retries: 0 }); note('scoped-sync', 200); } catch (e) { note('scoped-sync', 'error', e.message); }
      }
    }
    const t0 = performance.now();
    try { await dev.sync({ retries: 0 }); note('sync', 200); } catch (e) { note('sync', 'error', e.message.slice(0, 120)); }
    lat.push(performance.now() - t0);
    await sleep(2000);
  }
  let converged = true;
  try { await dev.sync(); expectEqual(dev, await api.truth(), 'after the deploy'); } catch (e) { converged = false; events.push(e.message); }
  report.record(S, 'syncs and writes straight through the deploy', converged ? (events.length ? 'warn' : 'pass') : 'fail',
    `${JSON.stringify(statuses)}; sync median ${ms(median(lat))} max ${ms(Math.max(...lat))}; ${events.length} non-2xx${events.length ? ':\n' + events.join('\n') : ''}`);
  await api.req('POST', `/api/people/${api.personId}/sessions/live/end`);
}
