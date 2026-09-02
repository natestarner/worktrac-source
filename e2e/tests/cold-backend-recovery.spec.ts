import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

// The white screen, and the state that made it permanent.
// Full narrative: docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md.
//
// Measured on lower on 2026-09-02: with the Container App scaled to zero, the ingress HOLDS a
// request open for ~35s while a replica starts -- it does not refuse and does not 503. The client
// aborts at 15s. So "the first call after a scale-to-zero fails" is not an edge case on that
// environment; it is arithmetic. Both scenarios below are built on exactly that shape.
//
// These run under the ordinary fast config rather than the PWA one: neither depends on the service
// worker (the reported trigger was a service-worker reload, but the reload is only how the app got
// to a fresh boot -- an ordinary refresh reaches the same state, which is why the user could
// reproduce it without a deploy).
test.describe('Cold backend recovery', () => {
  // The blank screen itself. AppShell used to `return null` with no active person, which is a
  // literally empty #root -- and boot-watchdog.js reports an empty #root as "Huddle couldn't
  // load". Reproduced in a real browser: #root emptied at 0.15s and the watchdog fired at 7s with
  // nothing broken except that no person was selected.
  //
  // The empty-people case is the one that latches rather than passing in a frame: nothing will
  // ever auto-select a person, and RECONCILE_PEOPLE's result is written to localStorage
  // synchronously, so every later boot starts here too. That is why "clearing site data" was the
  // only reported cure.
  test('an account with no people shows a way forward, never a blank screen', async ({ page, request }) => {
    await registerHousehold(page, request, 'BlankRootTest');

    await page.route('**/api/auth/me', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.people = [];
      await route.fulfill({ response, body: JSON.stringify(body), contentType: 'application/json' });
    });
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('worktrac-appstate-')) continue;
        const slice = JSON.parse(localStorage.getItem(key) as string);
        slice.activePersonId = null;
        slice.byPerson = {};
        localStorage.setItem(key, JSON.stringify(slice));
      }
    });

    await page.goto('/app/log');

    await expect(page.getByText('No one to log for yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to login' })).toHaveAttribute('href', '/login');

    // The real assertion, and it has to outlast the watchdog's 7s grace: #root must still be
    // painted after the window in which it would have declared the app dead.
    await page.waitForTimeout(9000);
    await expect(page.getByText("Huddle couldn't load")).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByText('No one to log for yet')).toBeVisible();
  });

  // The root cause. login() used to run every teardown -- resetQueryCache, clearAuthSnapshot --
  // and persist the new token BEFORE /me had confirmed anything, so a /me that timed out left a
  // VALID token with no identity snapshot and no cached data. AuthContext's boot effect reads that
  // as "retry /me forever", so every subsequent reload sat on the boot skeleton with no way out.
  test('a sign-in whose /me times out leaves nothing behind, and the next boot still reaches login', async ({
    page,
    request,
  }) => {
    const email = await registerHousehold(page, request, 'StrandedTokenTest');
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.evaluate(() => localStorage.removeItem('worktrac-auth-snapshot'));

    // POST /api/auth/login passes through (credentials are accepted by a replica that is up);
    // GET /api/auth/me is held open past the client's abort, the way a still-starting replica
    // behaves. This is the exact interleaving the report describes.
    await page.route('**/api/auth/me', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 40000));
      await route.abort('connectionfailed').catch(() => {});
    });

    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill('password123');
    await page.getByRole('button', { name: 'Log in' }).click();

    // A human message, not the AbortController's "signal is aborted without reason".
    await expect(page.getByRole('alert')).toContainText(/couldn’t reach huddle/i, { timeout: 30000 });

    // Nothing stranded: a token with no snapshot behind it is what made every later boot sit on a
    // skeleton forever with only "clear site data" to escape it.
    expect(await page.evaluate(() => localStorage.getItem('workout-tracker-token'))).toBeNull();

    // ...so a reload lands on a usable login screen rather than an endless boot.
    await page.unroute('**/api/auth/me');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });
});
