import { defineConfig, devices } from '@playwright/test';

// Durability specs (cold-load fully offline, a queued write surviving a reload while offline)
// depend on the production service worker precaching the app shell -- something `vite dev`
// cannot provide (see frontend/vite.config.js's devOptions.enabled:false and its comment on why).
// This is a SEPARATE config, not a project in the main playwright.config.ts, because a webServer
// is a whole-run setting in Playwright, not per-project -- folding a `npm run build` into the main
// config would pay that cost on every fast local run. Invoke via `npm run test:pwa`.
//
// FRONTEND_PORT/VITE_BACKEND_ORIGIN let this run against a git worktree's own isolated stack
// (see scripts/worktree-env.sh) instead of always assuming the primary worktree's fixed
// 3000/8080 -- default to those historical values so an invocation with no env vars set
// (a plain `npm run test:pwa`) behaves exactly as before. Whichever port is used must have
// its origin covered by the backend's CORS_ALLOWED_ORIGINS (see backend's application.yml):
// `vite preview`'s own proxy forwards the browser's real Origin header through to the backend
// rather than hiding it, so this can't just run on an uncovered port.
const FRONTEND_PORT = process.env.FRONTEND_PORT || '3000';
const BACKEND_ORIGIN = process.env.VITE_BACKEND_ORIGIN || 'http://localhost:8080';
const baseURL = `http://localhost:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/offline-durability.spec.ts', '**/history-full-refresh.spec.ts'],
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
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm --prefix ../frontend run build && npm --prefix ../frontend run preview',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      FRONTEND_PORT,
      VITE_BACKEND_ORIGIN: BACKEND_ORIGIN,
    },
  },
  projects: [
    {
      name: 'chromium-pwa',
      testMatch: ['**/offline-durability.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    // Safari's engine WITH the production service worker -- the one combination the default suite
    // cannot reach (vite dev has no worker, and the default WebKit project blocks workers so
    // page.route can see requests; e2e-tests.md, "WebKit"). Worker-served Safari is where #431
    // lived: the navigation entry of a reload on History is named /index.html, so the full
    // re-download never fired. history-full-refresh.spec.ts is that bug's regression test here.
    {
      name: 'webkit-pwa',
      testMatch: ['**/history-full-refresh.spec.ts'],
      use: { ...devices['iPhone 15'] },
    },
  ],
});
