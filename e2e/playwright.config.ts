import { defineConfig, devices } from '@playwright/test';

// Determine which environment to test against
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,      // Fail if test.only is left in CI
  retries: process.env.CI ? 2 : 0,   // Retry flaky tests in CI only
  workers: process.env.CI ? 1 : undefined,  // Single worker in CI for stability
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
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
