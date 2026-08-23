import { defineConfig, devices } from '@playwright/test';

// The marketing site (huddle.fitness / dev.huddle.fitness) is a separate static site on its own
// Static Web App, so it needs its own baseURL and its own testDir -- it must NOT be pulled into
// the app suite, which points at the app origin and has a globalTeardown that registers accounts.
//
// Deliberately minimal next to playwright.config.ts: this suite has no auth, no database, no
// service worker and no per-worker contention, so none of that file's worker/timeout reasoning
// applies here.
//
// Run against a local static server:
//   cd marketing && python -m http.server 8099
//   cd e2e && npm run test:marketing
// Or against a deployed environment:
//   MARKETING_BASE_URL=https://dev.huddle.fitness npm run test:marketing
const baseURL = process.env.MARKETING_BASE_URL || 'http://localhost:8099';

export default defineConfig({
  testDir: './marketing-tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Chromium only, at two widths. devices['iPhone 13'] would be a truer phone but it is a WebKit
  // descriptor, and this repo installs chromium only (see playwright.config.ts) -- using it here
  // would make `npm run test:marketing` fail on a missing browser rather than on the page. The
  // narrow viewport is what these assertions actually care about.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: false,
        hasTouch: true,
      },
    },
  ],
});
