import { defineConfig, devices } from '@playwright/test';

// Determine which environment to test against
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const isDeployedEnv = !!process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,      // Fail if test.only is left in CI
  retries: process.env.CI ? 2 : 0,   // Retry flaky tests in CI only
  // 2 workers in CI: all specs already isolate via per-test random accounts (see
  // admin.spec.ts etc.), so data collisions aren't the concern -- the lower-env DB is
  // Azure SQL free tier with limited concurrency headroom, so we go modest rather than
  // fully parallel.
  workers: process.env.CI ? 2 : undefined,
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
