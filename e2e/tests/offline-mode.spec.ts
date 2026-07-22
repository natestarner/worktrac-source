import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

// PR 1 of offline mode: the app recognizes offline state and (with the production service worker)
// cold-loads and boots a saved session with no network. The durable write outbox lands in later PRs.
test.describe('Offline mode — shell, boot, and connectivity signal', () => {
  test('shows the offline banner when connectivity drops mid-session and clears when it returns', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'Riley');
    await expect(page).toHaveURL(/\/app\/log/);

    // No banner while online.
    await expect(page.getByText(/your changes are saved on this device/i)).toBeHidden();

    // Lose the connection mid-session -> the banner appears immediately, no reload.
    await page.context().setOffline(true);
    await expect(page.getByText(/your changes are saved on this device/i)).toBeVisible();

    // Reconnect -> the banner clears on its own.
    await page.context().setOffline(false);
    await expect(page.getByText(/your changes are saved on this device/i)).toBeHidden();
  });

  // The cold-load path depends on the generated service worker precaching the shell, which only
  // exists in a production build (it's disabled in `vite dev`). So this runs against a deployed
  // target (the lower-env e2e job sets E2E_BASE_URL); it's skipped against local `vite dev`.
  test('cold-loads from cache and boots the saved session while fully offline', async ({ page, request }) => {
    test.skip(
      !process.env.E2E_BASE_URL,
      'cold-load offline requires the production service worker, absent in local vite dev',
    );

    await registerHousehold(page, request, 'Jordan');
    await expect(page).toHaveURL(/\/app\/log/);

    // Let the service worker install and take control (registerType:'prompt' claims clients on the
    // next load), so the precached shell is available to serve the offline navigation below.
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });

    // Fully offline cold load: the SW serves index.html + assets from cache, /me fails, and the app
    // boots the saved session from the identity snapshot instead of bouncing to /login.
    await page.context().setOffline(true);
    await page.reload();

    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText(/your changes are saved on this device/i)).toBeVisible();
    // The person from the snapshot renders -- proof we booted an authenticated session offline.
    await expect(page.locator('.person-pill-bar').getByRole('button', { name: /Jordan/ })).toBeVisible();

    await page.context().setOffline(false);
  });
});
