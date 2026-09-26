// Read-only views of lower through the gh and az CLIs (docs/azure-read-only-access.md): is a deploy
// or its e2e running, how busy the database is, replica count, and log queries. Every call degrades
// to `null` when the CLI is missing or not signed in -- the barrage then says it couldn't check.
import { spawnSync } from 'node:child_process';
import { LOWER, log, sleep } from './config.mjs';

// On Windows gh/az are .cmd shims, so they run through cmd.exe, which would read the `&` in a URL or
// the parentheses in `length(@)` as its own syntax. Quote any argument holding one.
const quoteForCmd = (a) => (/[\s&|<>^()"%]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function run(cmd, args, { timeoutMs = 120000 } = {}) {
  if (process.platform === 'win32') args = args.map(quoteForCmd);
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', timeout: timeoutMs, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function json(cmd, args, options) {
  const out = run(cmd, args, options);
  if (out == null || out === '') return null;
  try { return JSON.parse(out); } catch { return null; }
}

let owner;
export function repoOwner() {
  owner ??= run('gh', ['repo', 'view', '--json', 'owner', '-q', '.owner.login']);
  return owner;
}

// The latest deploy-lower.yml run: { id, title, status, e2eStatus }.
export function latestLowerDeploy() {
  const o = repoOwner();
  if (!o) return null;
  const runs = json('gh', ['run', 'list', '-R', `${o}/worktrac-deploy`, '--workflow=deploy-lower.yml', '--limit', '1', '--json', 'databaseId,displayTitle,status,conclusion']);
  if (!runs?.length) return null;
  const jobs = json('gh', ['run', 'view', '-R', `${o}/worktrac-deploy`, String(runs[0].databaseId), '--json', 'jobs']);
  const e2e = jobs?.jobs?.find((j) => j.name === 'e2e-tests');
  return { id: runs[0].databaseId, title: runs[0].displayTitle, status: runs[0].status, conclusion: runs[0].conclusion, e2eStatus: e2e?.status ?? null };
}

// Waits (up to maxMin) while a lower deploy -- above all its e2e run -- is in progress. The barrage
// on top of lower's e2e overloads a 5-DTU database and makes BOTH flaky: it happened on 2026-09-26.
export async function waitForLowerQuiet(maxMin = 45) {
  const deadline = Date.now() + maxMin * 60000;
  for (;;) {
    const d = latestLowerDeploy();
    if (!d) return { checked: false };
    if (d.status === 'completed') return { checked: true, quiet: true, deploy: d };
    if (Date.now() > deadline) return { checked: true, quiet: false, deploy: d };
    log(`waiting: lower deploy "${d.title}" is ${d.status} (e2e ${d.e2eStatus ?? '?'})`);
    await sleep(30000);
  }
}

let subscription;
function sub() {
  subscription ??= run('az', ['account', 'show', '--query', 'id', '-o', 'tsv']);
  return subscription;
}

// Per-minute { t, max, avg } CPU of lower's database between two Dates.
export function dbCpu(from, to) {
  const s = sub();
  if (!s) return null;
  const id = `/subscriptions/${s}/resourceGroups/${LOWER.resourceGroup}/providers/Microsoft.Sql/servers/${LOWER.sqlServer}/databases/${LOWER.database}`;
  const data = json('az', ['monitor', 'metrics', 'list', '--resource', id, '--metric', 'cpu_percent',
    '--start-time', from.toISOString().slice(0, 19) + 'Z', '--end-time', to.toISOString().slice(0, 19) + 'Z',
    '--interval', 'PT1M', '--aggregation', 'Maximum', 'Average', '-o', 'json']);
  const points = data?.value?.[0]?.timeseries?.[0]?.data;
  if (!points) return null;
  return points.map((p) => ({ t: p.timeStamp, max: p.maximum, avg: p.average }));
}

// Waits until the database's last few minutes average under `threshold`% CPU, so timings measure
// the app rather than whatever else was running (a post-e2e cleanup once doubled every number).
export async function waitForDbIdle({ threshold = 35, maxMin = 10 } = {}) {
  const deadline = Date.now() + maxMin * 60000;
  for (;;) {
    const pts = dbCpu(new Date(Date.now() - 4 * 60000), new Date());
    if (!pts) return { checked: false };
    const recent = pts.filter((p) => p.avg != null).slice(-2);
    const avg = recent.length ? recent.reduce((n, p) => n + p.avg, 0) / recent.length : 0;
    if (avg < threshold) return { checked: true, idle: true, avg };
    if (Date.now() > deadline) return { checked: true, idle: false, avg };
    log(`waiting: lower database at ${avg.toFixed(0)}% CPU`);
    await sleep(30000);
  }
}

export function replicaCount() {
  const out = run('az', ['containerapp', 'replica', 'list', '-g', LOWER.resourceGroup, '-n', LOWER.containerApp, '--query', 'length(@)', '-o', 'tsv']);
  return out == null ? null : Number(out);
}

// Rows of a KQL query against the logs workspace, as arrays.
export function kql(query) {
  const data = json('az', ['monitor', 'log-analytics', 'query', '--workspace', LOWER.logWorkspace, '--analytics-query', query, '-o', 'json'], { timeoutMs: 180000 });
  return data ?? null;
}

// The source commit each environment runs, from worktrac-deploy's branch history.
export function deployedCommit(branch) {
  const o = repoOwner();
  if (!o) return null;
  const commits = json('gh', ['api', `repos/${o}/worktrac-deploy/commits?sha=${branch}&per_page=30`]);
  for (const c of commits ?? []) {
    const m = c.commit?.message?.match(/^Deploy ([0-9a-f]{7,40}) to/);
    if (m) return m[1];
  }
  return null;
}
