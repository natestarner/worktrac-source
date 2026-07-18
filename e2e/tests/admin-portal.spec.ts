import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

// Only covers the non-admin security boundary here, not "an admin can reach the portal" --
// that positive path depends on the real, fixed ADMIN_EMAILS allowlist configured per
// environment (see worktrac-deploy), which isn't something an e2e run can safely exercise:
// the admin email can only be registered once per environment (a second registration 409s),
// so there's no repeatable, CI-safe way to drive it here. The admin-promotion path is
// covered instead at the backend integration level (AdminAuthorizationTest), which injects
// its own disposable admin email via a test-only property override.
test.describe('Admin portal', () => {
  test('an ordinary household never sees or reaches the admin portal', async ({ page, request }) => {
    await registerHousehold(page, request, 'Casey');

    // No admin link in the user menu for a plain user.
    await page.locator('.header-bar').getByRole('button').click();
    await expect(page.getByRole('menuitem', { name: 'Admin Portal' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Direct navigation redirects away rather than revealing the portal exists.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/app\/log/);

    // The API itself rejects it too, not just the frontend route guard.
    const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
    const configResponse = await request.get('/config.json');
    const { apiUrl } = await configResponse.json();
    const response = await request.get(`${apiUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(403);
  });
});
