import { defineConfig, devices } from '@playwright/test';

// Durability specs (cold-load fully offline, a queued write surviving a reload while offline)
// depend on the production service worker precaching the app shell -- something `vite dev`
// cannot provide (see frontend/vite.config.js's devOptions.enabled:false and its comment on why).
// This is a SEPARATE config, not a project in the main playwright.config.ts, because a webServer
// is a whole-run setting in Playwright, not per-project -- folding a `npm run build` into the main
// config would pay that cost on every fast local run. Invoke via `npm run test:pwa`.
//
// Requires port 3000 to be free (stop any running `vite dev`/`vite preview` first): CORS locally
// defaults to allowing only http://localhost:3000 (see backend's application.yml), and `vite
// preview`'s own proxy forwards the browser's real Origin header through to the backend rather
// than hiding it -- so this can't simply run on a different port without also reconfiguring CORS.
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/offline-durability.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never', outputFolder: 'pwa-report' }],
    ['list'],
  ],
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm --prefix ../frontend run build && npm --prefix ../frontend run preview',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium-pwa',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
