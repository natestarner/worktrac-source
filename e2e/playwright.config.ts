import { defineConfig, devices } from '@playwright/test';

// Determine which environment to test against
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const isDeployedEnv = !!process.env.E2E_BASE_URL;

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
  retries: process.env.CI ? 2 : 0,   // Retry flaky tests in CI only
  // 2 workers everywhere: all specs already isolate via per-test random accounts (see
  // admin.spec.ts etc.), so data collisions aren't the concern -- it's concurrency headroom.
  // CI/lower's Azure SQL free tier has limited headroom; a local run is just as constrained
  // in practice -- one backend process, one bounded HikariCP pool, one SQL Server container --
  // so leaving local on Playwright's default (auto-detected CPU core count, often 8-16) let a
  // full local suite run overwhelm the pool with concurrent registrations and cascade into
  // HikariPool timeouts across nearly every spec (see git history on this comment).
  workers: 2,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  // A real deployed target (lower/production) has real network latency and shared,
  // resource-constrained infra that localhost doesn't -- give assertions more headroom there
  // by default instead of bumping Playwright's 5s default one call site at a time as each new
  // flow happens to hit it (see git history: this happened repeatedly for the registration
  // email flow before it became a blanket default here).
  expect: {
    timeout: isDeployedEnv ? 15000 : 5000,
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
