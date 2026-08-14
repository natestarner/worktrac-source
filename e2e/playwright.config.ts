import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';

// Determine which environment to test against
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

// "Deployed" means the target is not on this machine -- decided by the URL, NOT by whether
// E2E_BASE_URL happens to be set.
//
// This used to be `!!process.env.E2E_BASE_URL`, which was true when the var was introduced and
// stopped being true once scripts/e2e.sh started setting E2E_BASE_URL on EVERY run to point at the
// current worktree's own port. From then on every local run from a worktree silently took the
// deployed branch. It went unnoticed because the deployed branch is the more generous one -- so
// the bug's only symptom was that local and deployed runs could not actually be configured
// differently, which is the entire purpose of this flag.
//
// globalTeardown.ts already decides the same question the same way (and must: it refuses to
// register a real admin account against a real environment). Keep the two consistent.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
function resolveIsDeployed(): boolean {
  try {
    return !LOCAL_HOSTNAMES.has(new URL(baseURL).hostname);
  } catch {
    // A malformed E2E_BASE_URL (e.g. "localhost:3000", missing the scheme) would otherwise throw
    // here and fail the whole run with a config stack trace that never mentions the real problem.
    throw new Error(`E2E_BASE_URL is not a valid absolute URL: "${baseURL}" (did you omit http://?)`);
  }
}
const isDeployedEnv = resolveIsDeployed();

// How many workers this run will ACTUALLY use.
//
// Every spec already isolates itself -- its own household, its own browser context, and all app
// data is account-scoped in the schema -- so parallelism has never been a data-collision risk.
// What it costs is TIME per test: one local backend, one Vite dev server and one SQL Server serve
// every worker at once, so each test's wall-clock grows with the worker count (measured on a
// 22-core machine: the slowest spec takes ~8s alone, 12.3s at 4 workers, 19.2s at 11).
//
// That is why this number has to be known here rather than left to Playwright. The timeout
// budgets below are what a test is allowed to spend, and if they stay fixed while workers go up,
// raising parallelism silently eats the headroom until specs start timing out -- which looks like
// a flaky app and is really a budget that was never told the run got busier. Deriving both from
// one number keeps them in step.
//
// Local default is a quarter of the cores rather than Playwright's own cpus/2, because this
// machine routinely has more than one worktree's stack running (see CLAUDE.md's "Concurrent
// sessions") -- a suite that grabs half the box makes a sibling session's suite flaky, which is
// the same problem one level up. Raise it with E2E_WORKERS=<n> when the machine is yours alone.
//
// A deployed target stays at 2 regardless of local cores: lower's Azure SQL is Basic tier and its
// Container App scales to zero, so the constraint there is the environment, not this machine.
function resolveWorkerCount(): number {
  if (isDeployedEnv) return 2;

  // Playwright resolves `workers` after this file is evaluated, and a CLI `--workers` overrides
  // whatever the config returns -- so read the same inputs it will, in its own precedence order.
  // Without this, `--workers=11` would run with a 2-worker time budget, i.e. exactly the failure
  // this function exists to prevent.
  const arg = process.argv.find((a) => a === '--workers' || a.startsWith('--workers='));
  const raw = arg
    ? (arg.includes('=') ? arg.split('=')[1] : process.argv[process.argv.indexOf(arg) + 1])
    : process.env.E2E_WORKERS;

  const cores = os.cpus().length;
  if (raw) {
    // Playwright accepts a percentage of cores ("50%") as well as a plain count.
    const parsed = raw.trim().endsWith('%')
      ? Math.ceil((cores * parseFloat(raw)) / 100)
      : parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Math.min(8, Math.max(2, Math.ceil(cores / 4)));
}

const workerCount = resolveWorkerCount();

// Budgets, not speed assertions. Nothing in this suite asserts that the app is fast, so a bigger
// number here removes no coverage -- it only changes how long a genuinely stuck test takes to
// report. They stay bounded (and scale with contention rather than being one flat generous
// number) so a real hang still fails in tens of seconds instead of minutes.
//
// Base values are what a single worker needs; the per-worker term is the contention above.
//
// The local assertion base is 12s rather than the 5s this file used to name, and that is not a
// loosening: because of the isDeployedEnv bug above, every worktree-local run has actually been
// taking the 15s deployed value for as long as scripts/e2e.sh has set E2E_BASE_URL. Fixing the
// detection while restoring a literal 5s would have made local assertions three times tighter
// than what the suite has been passing under -- a new source of flakiness introduced by a
// bug fix. 12s + 1.5s/worker never lands below the value local has been living with.
const perTestTimeout = 30_000 + workerCount * 5_000;
const assertionTimeout = isDeployedEnv ? 15_000 : 12_000 + workerCount * 1_500;

export default defineConfig({
  testDir: './tests',
  // Durability specs need the production service worker (absent in `vite dev`) -- they run via
  // `npm run test:pwa` (playwright.pwa.config.ts) against a preview build instead.
  testIgnore: ['**/offline-durability.spec.ts'],
  // No-ops against a deployed target (lower/production) -- see the file's own localhost guard.
  // Keeps repeated LOCAL runs from accumulating huddle+e2e-... accounts indefinitely.
  globalTeardown: './tests/support/globalTeardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,      // Fail if test.only is left in CI
  // Deliberately NO local retries. A retry turns a flake into a pass and hides the signal that
  // something is genuinely wrong -- and this suite's whole reason for existing is to catch
  // degraded-condition bugs, which are exactly the kind that present as intermittent. CI retries
  // because a shared runner has failure modes the code cannot fix.
  retries: process.env.CI ? 2 : 0,
  workers: workerCount,
  // Playwright's default is 30s and was never set here. That is enough for one worker and not for
  // several, so the per-test budget was the first thing to run out as parallelism went up: a spec
  // that legitimately takes 12s alone has no room left at 19s under load, and fails on the clock
  // rather than on a defect. See resolveWorkerCount above.
  timeout: perTestTimeout,
  // The `json` reporter is what makes flakiness measurable ACROSS runs rather than one run at a
  // time. CI retries (above) mean a test that fails and then passes is recorded as `flaky` while
  // the run still goes green -- so the run's own pass/fail conclusion carries no flake signal at
  // all, and the only durable record is per-test. Measured 2026-08-14 over the 51 lower runs still
  // retained: 42 were green, and 38 of those 42 contained at least one flaky test.
  //
  // The same per-test outcomes are technically inside the html report too, but only as a
  // base64'd zip embedded in `index.html` -- an internal format with no compatibility promise,
  // which had to be scraped to learn the above. This writes the same thing through a documented
  // reporter instead.
  //
  // It must NOT be written into `playwright-report/`: the html reporter calls removeFolders() on
  // its own output folder before generating (playwright/lib/runner/index.js), so anything another
  // reporter puts there is deleted depending on which finishes first. `test-results/` is the
  // configured outputDir -- cleared BEFORE the run, never after -- so an end-of-run write survives.
  // Both directories are already gitignored.
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],
  // A real deployed target (lower/production) has real network latency and shared,
  // resource-constrained infra that localhost doesn't -- give assertions more headroom there
  // by default instead of bumping Playwright's 5s default one call site at a time as each new
  // flow happens to hit it (see git history: this happened repeatedly for the registration
  // email flow before it became a blanket default here). Locally the same argument applies to
  // worker contention, hence the scaling above.
  expect: {
    timeout: assertionTimeout,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
