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

  // The plan-granting routes are the portal's most privileged action -- a household that could
  // reach them could give itself Plus or Pro for nothing. Asserted through the REAL deployed
  // security chain rather than MockMvc, because that chain is what actually runs: the route matcher
  // in SecurityConfig, the ADMIN_EMAILS re-check in JwtAuthenticationFilter, and the servlet
  // container's own error dispatch, which has turned a 403 into a 401 before now
  // (PermissionInterceptor's comment in backend-core.md -- MockMvc structurally cannot catch that).
  test('an ordinary household cannot grant itself a paid plan', async ({ page, request }) => {
    await registerHousehold(page, request, 'Robin');

    const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
    const configResponse = await request.get('/config.json');
    const { apiUrl } = await configResponse.json();
    const auth = { Authorization: `Bearer ${token}` };

    // Account id 1 stands in for "somebody's household". The point is that the refusal happens at
    // the route, before anything looks at which household was named -- so it holds for their own
    // id just as much as for a guessed one.
    const granted = await request.post(`${apiUrl}/api/admin/accounts/1/comp`, {
      headers: auth,
      data: { plan: 'PRO', band: 'UNLIMITED', note: 'free pro please' },
    });
    expect(granted.status()).toBe(403);

    const revoked = await request.delete(`${apiUrl}/api/admin/accounts/1/comp`, { headers: auth });
    expect(revoked.status()).toBe(403);

    // And with no token at all it is a 401, never an accidental permitAll.
    const anonymous = await request.post(`${apiUrl}/api/admin/accounts/1/comp`, {
      data: { plan: 'PLUS' },
    });
    expect(anonymous.status()).toBe(401);

    // The refusal changed nothing: this household is still on Free.
    await page.reload();
    const me = await request.get(`${apiUrl}/api/billing/subscription`, { headers: auth });
    expect(me.status()).toBe(200);
    expect((await me.json()).plan).toBe('FREE');
  });
});
