import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

// The last-resort watchdog in frontend/public/boot-watchdog.js -- plain, dependency-free JS
// outside the React bundle, so it can show an escape hatch even when nothing in the React tree,
// including every one of its three error boundaries, gets the chance to. See that file's own
// header for the two prior "app painted, then went white, no way back except manually typing the
// login URL" reports it exists to close.
//
// It cannot be driven from Vitest (no real DOM timers/paint, and it's deliberately outside the
// Vite/React bundle Vitest exercises) -- this is the one place its actual behaviour is provable,
// against a real browser and real timers. Runs under the normal fast e2e config: `public/*`
// files (including this one) are served identically by `vite dev` and a production build, so this
// doesn't need the slow production-preview PWA config offline-durability.spec.ts uses.
test.describe('Boot watchdog', () => {
  test('shows a login escape hatch if the app tree ever goes fully blank, however that happened', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'WatchdogTest');

    // Simulate the one situation no React error boundary can itself prove it handles: every
    // single one bypassed, so nothing in the tree is left to ask. This is deliberately NOT a
    // simulated crash of any specific component -- the watchdog doesn't care why #root emptied,
    // only that it did.
    await page.evaluate(() => {
      const root = document.getElementById('root');
      if (root) root.innerHTML = '';
    });

    // GRACE_MS in boot-watchdog.js, plus headroom for the assertion's own poll.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Huddle couldn't load")).toBeVisible();
    await expect(page.getByText(/saved on this device/i)).toBeVisible();

    // A real navigation, not a React Router one -- proven by following it through to the actual
    // login screen rather than just asserting the href.
    await page.getByRole('link', { name: 'Go to login' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });
});
