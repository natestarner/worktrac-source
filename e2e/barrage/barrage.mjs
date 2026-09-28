#!/usr/bin/env node
// The barrage: the History-sync pressure test from 2026-09-26, made repeatable. See README.md.
//
//   node e2e/barrage/barrage.mjs [--target lower|local] [--tier quick|standard|full]
//        [--suites a,b] [--engines chromium,webkit] [--only scenario,...] [--baseline <sha>]
//        [--seed] [--no-wait] [--watch-deploy]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Api } from './lib/api.mjs';
import { Cleanup, MIN_SEEDED_WORKOUTS, registerLocal, seed } from './lib/account.mjs';
import { E2E_DIR, LOWER, localTarget, log, lowerCredentials, sleep } from './lib/config.mjs';
import { deployedCommit, latestLowerDeploy, waitForDbIdle, waitForLowerQuiet } from './lib/ops.mjs';
import { Report } from './lib/report.mjs';
import * as apiSuites from './suites/api.mjs';
import { browserMatrix, signInOnce } from './suites/browser.mjs';
import { buildBaseline, buildCurrent, outcome, requests } from './suites/compare.mjs';
import { ops } from './suites/ops.mjs';
import { coldStart, perf, statsPerf } from './suites/perf.mjs';

const CORE_SCENARIOS = ['two-months-drain-slow-sync', 'drain-on-reopen', 'other-device-on-open', 'lie-fi', 'long-jump'];
const WEBKIT_STANDARD = [...CORE_SCENARIOS, 'old-format-upgrade', 'rolling-check'];

// Which suites each tier runs. Order matters: correctness first, load last, ops after cleanup.
const TIERS = {
  quick: ['api:abuse', 'api:correctness', 'api:bench', 'browser:chromium:core', 'signin'],
  standard: ['api:abuse', 'api:correctness', 'api:bench', 'api:load', 'browser:chromium', 'browser:webkit:standard', 'signin', 'perf', 'perf:stats'],
  full: ['api:abuse', 'api:correctness', 'api:bench', 'api:load', 'api:storm', 'browser:chromium', 'browser:webkit', 'signin', 'perf', 'perf:stats', 'compare', 'cold-start'],
};

function parseArgs(argv) {
  const args = { target: 'lower', tier: 'quick', engines: null, suites: null, only: null, baseline: null, seed: false, wait: true, watchDeploy: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--target') args.target = next();
    else if (a === '--tier') args.tier = next();
    else if (a === '--engines') args.engines = next().split(',');
    else if (a === '--suites') args.suites = next().split(',');
    else if (a === '--only') args.only = next().split(',');
    else if (a === '--baseline') args.baseline = next();
    else if (a === '--seed') args.seed = true;
    else if (a === '--no-wait') args.wait = false;
    else if (a === '--watch-deploy') args.watchDeploy = true;
    else if (a === '--help' || a === '-h') { console.log(readHelp()); process.exit(0); }
    else throw new Error(`unknown argument ${a}`);
  }
  if (!TIERS[args.tier]) throw new Error(`unknown tier ${args.tier}`);
  return args;
}

function readHelp() {
  return `Usage: node e2e/barrage/barrage.mjs [--target lower|local] [--tier quick|standard|full]
  --suites a,b        run only these suites (${[...new Set(Object.values(TIERS).flat())].join(', ')})
  --engines a,b       browser engines (default: per tier)
  --only s1,s2        run only these browser scenarios
  --baseline <sha>    the build to compare against (default: production's)
  --seed              seed the lower account with five years of History if it has less
  --no-wait           don't wait for a lower deploy / e2e run to finish first
  --watch-deploy      sync and write straight through the next lower deploy, stop when its e2e starts
See e2e/barrage/README.md.`;
}

async function frontendBuild(app) {
  const html = await fetch(app).then((r) => r.text()).catch(() => '');
  return html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? 'unknown';
}

async function healthy(base) {
  for (let i = 0; i < 12; i += 1) {
    const ok = await fetch(`${base}/actuator/health`, { signal: AbortSignal.timeout(60000) }).then((r) => r.ok, () => false);
    if (ok) return true;
    await sleep(5000);
  }
  return false;
}

function portListening(port) {
  const r = process.platform === 'win32'
    ? spawnSync('netstat', ['-ano'], { encoding: 'utf8' })
    : spawnSync('sh', ['-c', `ss -ltn 2>/dev/null || netstat -ltn`], { encoding: 'utf8' });
  return new RegExp(`[:.]${port}\\s.*LISTEN`, 'i').test(r.stdout || '');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runStartedAt = new Date();
  const runId = runStartedAt.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const target = args.target === 'local' ? localTarget() : LOWER;
  const suites = args.watchDeploy ? ['deploy-watch'] : (args.suites ?? TIERS[args.tier]);
  const engines = args.engines ?? [...new Set(suites.filter((s) => s.startsWith('browser:')).map((s) => s.split(':')[1]))];
  const report = new Report(path.join(E2E_DIR, 'barrage-reports', `${runId}-${args.target}-${args.watchDeploy ? 'watch' : args.tier}`),
    { runId, target: args.target, tier: args.watchDeploy ? 'watch-deploy' : args.tier, suites, engines });

  // ── preflight ───────────────────────────────────────────────────────────────────────────────
  if (args.target === 'lower' && args.wait && !args.watchDeploy) {
    const quiet = await waitForLowerQuiet();
    if (!quiet.checked) report.note('Could not check for a running lower deploy (gh unavailable); running anyway.');
    else if (!quiet.quiet) throw new Error(`a lower deploy is still running after 45 min (${quiet.deploy.title}); rerun later or pass --no-wait`);
  }
  if (!(await healthy(target.api))) throw new Error(`backend not healthy at ${target.api}`);

  let creds;
  let api;
  let usesPreview = false;
  let previewChild = null;
  if (args.target === 'lower') {
    creds = lowerCredentials();
    api = await Api.login(target.api, creds.email, creds.password);
  } else {
    const needsBrowser = suites.some((s) => s.startsWith('browser') || s === 'signin' || s.startsWith('perf') || s === 'compare');
    if (needsBrowser && portListening(target.frontendPort)) {
      throw new Error(`port ${target.frontendPort} is in use (the dev server?). The local barrage serves production builds itself -- stop the frontend first (see the /barrage command).`);
    }
    if (suites.some((s) => s !== 'compare')) {
      log('registering a throwaway local account with five years of History');
      const local = await registerLocal(target.api);
      creds = { email: local.email, password: local.password };
      api = local.api;
    }
    usesPreview = needsBrowser && suites.some((s) => s.startsWith('browser') || s === 'signin' || s.startsWith('perf'));
  }

  let seeded = 0;
  if (api) {
    const truth = await api.truth();
    seeded = truth.length;
    if (seeded < MIN_SEEDED_WORKOUTS && args.target === 'lower' && !args.watchDeploy) {
      if (!args.seed) throw new Error(`the lower account holds ${seeded} workouts; the barrage needs years of History. Run once with --seed.`);
      await seed(api);
      seeded = (await api.truth()).length;
    }
  }

  report.meta.build = {
    'frontend bundle': await frontendBuild(target.app),
    ...(args.target === 'lower' ? { 'lower deploy': latestLowerDeploy()?.title ?? 'unknown', 'production runs': deployedCommit('production') ?? 'unknown' } : {}),
    'account History': `${seeded} workouts`,
  };
  const cleanup = api ? new Cleanup(api, runStartedAt) : null;
  const ctx = { target, creds, api, report, cleanup, runId, runStartedAt, seededWorkouts: seeded, only: args.only };

  // ── suites ──────────────────────────────────────────────────────────────────────────────────
  let current = null;
  let baseline = null;
  try {
    if (usesPreview) {
      current = buildCurrent();
      const { spawn } = await import('node:child_process');
      previewChild = spawn(process.execPath, [path.join(current.dir, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--strictPort'],
        { cwd: current.dir, env: { ...process.env, FRONTEND_PORT: target.frontendPort, VITE_BACKEND_ORIGIN: target.api }, stdio: 'ignore' });
      for (let i = 0; i < 60 && !(await fetch(target.app).then((r) => r.ok, () => false)); i += 1) await sleep(500);
      report.meta.build['frontend bundle'] = await frontendBuild(target.app);
    }
    for (const suite of suites) {
      log(`===== ${suite}`);
      try {
        if (suite === 'api:abuse') await apiSuites.abuse(ctx);
        else if (suite === 'api:correctness') await apiSuites.correctness(ctx);
        else if (suite === 'api:bench') {
          if (args.target === 'lower') {
            const idle = await waitForDbIdle();
            if (idle.checked && !idle.idle) report.note(`Database still at ${idle.avg.toFixed(0)}% CPU after waiting -- the API timings below are inflated.`);
          }
          await apiSuites.bench({ ...ctx, runs: args.tier === 'quick' ? 5 : 10 });
        } else if (suite === 'api:load') await apiSuites.realistic(ctx);
        else if (suite === 'api:storm') await apiSuites.storm(ctx);
        else if (suite === 'deploy-watch') {
          const start = latestLowerDeploy();
          let lastCheck = 0; let stop = false;
          const deadline = Date.now() + 90 * 60000;
          report.note(`Watching from "${start?.title}" (${start?.status}); stops when a lower e2e run starts.`);
          await apiSuites.deployWatch({ ...ctx, shouldStop: async () => {
            if (stop || Date.now() > deadline) return true;
            if (Date.now() - lastCheck < 20000) return false;
            lastCheck = Date.now();
            const d = latestLowerDeploy();
            stop = !!d && (d.id !== start?.id || d.status !== 'completed') && (d.e2eStatus === 'in_progress' || d.e2eStatus === 'completed');
            if (stop) report.note(`Stopped as "${d.title}" began its e2e run.`);
            return stop;
          } });
        } else if (suite.startsWith('browser:')) {
          const [, engine, set] = suite.split(':');
          if (args.engines && !args.engines.includes(engine)) continue;
          const only = args.only ?? (set === 'core' ? CORE_SCENARIOS : set === 'standard' ? WEBKIT_STANDARD : null);
          await browserMatrix({ ...ctx, engine, only });
        } else if (suite === 'signin') await signInOnce({ ...ctx, engine: 'chromium' });
        else if (suite === 'perf') await perf(ctx, args.tier === 'full' ? 4 : 3);
        else if (suite === 'perf:stats') await statsPerf(ctx, args.tier === 'full' ? 4 : 3);
        else if (suite === 'cold-start') {
          if (args.target !== 'lower') report.record('cold-start', 'app opened on a cold backend', 'skip', 'lower only (min-replicas=0)');
          else await coldStart(ctx);
        } else if (suite === 'compare') {
          const local = args.target === 'local' ? target : localTarget();
          if (!(await healthy(local.api))) { report.record('compare', 'baseline comparison', 'skip', `needs this worktree's local backend (${local.api}) -- run scripts/up.sh, then stop the dev frontend`); continue; }
          if (portListening(local.frontendPort) && !previewChild) { report.record('compare', 'baseline comparison', 'skip', `port ${local.frontendPort} is in use -- stop the dev frontend first`); continue; }
          if (previewChild) { previewChild.kill(); previewChild = null; await sleep(1500); }
          const sha = args.baseline ?? deployedCommit('production');
          if (!sha) { report.record('compare', 'baseline comparison', 'skip', 'could not find production\'s commit; pass --baseline <sha>'); continue; }
          report.meta.build.baseline = sha;
          baseline ??= buildBaseline(sha);
          current ??= buildCurrent();
          const cctx = { ...ctx, target: local };
          await outcome(cctx, baseline, current);
          await requests(cctx, baseline, current);
        } else report.record(suite, 'suite', 'skip', 'unknown suite');
      } catch (e) {
        report.record(suite, 'suite ran to completion', 'fail', String(e.stack || e).slice(0, 2000));
      }
    }
  } finally {
    if (previewChild) previewChild.kill();
    baseline?.cleanup();
    if (cleanup) {
      try {
        const c = await cleanup.run();
        report.record('cleanup', 'test data removed', 'info', `${c.deleted} set(s) deleted; account now ${c.workouts} workouts, ${c.sets} sets`);
      } catch (e) { report.record('cleanup', 'test data removed', 'warn', String(e.message)); }
    }
    if (args.target === 'lower' && !args.watchDeploy) {
      try { await ops(ctx); } catch (e) { report.record('ops', 'lower logs and metrics', 'warn', String(e.message)); }
    }
    const file = report.write();
    const c = report.counts();
    log(`REPORT ${file}`);
    log(`${c.fail ? 'FAILURES' : 'NO FAILURES'}: ${c.pass} pass, ${c.fail} fail, ${c.warn} warn, ${c.skip} skip`);
    process.exitCode = c.fail ? 1 : 0;
  }
}

main().catch((e) => { console.error(`barrage: ${e.message}`); process.exit(2); });
