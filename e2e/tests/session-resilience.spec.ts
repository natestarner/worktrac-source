import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { failNetwork, failWithStatus } from './support/faults';
import { outboxCountText, waitForOutboxDrain } from './support/offline';

// Two related session-resilience bugs found testing a local DB outage (backend up, database
// down, then restored):
//
// 1. The durable outbox replays queued writes on boot/reconnect with no check that there's an
//    authenticated session. A write dispatched with no Authorization header 401s, and a 401 can
//    itself tear down a session that a moment later DOES have a valid token -- turning a handful
//    of stuck queued writes into a bounce-to-/login loop that made logging back in look broken.
// 2. On a hard refresh during the outage, /me fails (server/DB unreachable) and there was no
//    saved identity snapshot to fall back to yet -- so the boot signed the user out to /login
//    even though the token itself was perfectly valid and the server was merely unreachable.
test.describe('Session resilience around a backend/DB outage', () => {
  test('a queued write with no valid session never dispatches tokenless, and logging back in sticks (no login loop)', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Rowan');
    await pickExercise(page, 'Barbell Bench Press');

    const faults = await failNetwork(page, '**/api/**');
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Simulate having been signed out while a write is still stuck in the outbox -- e.g. a prior
    // 401, or (as in the real incident) a DB-outage /me failure falling through to sign-out.
    await page.evaluate(() => localStorage.removeItem('workout-tracker-token'));

    const liveSetRequests: string[] = [];
    page.on('request', (req) => {
      if (/\/api\/people\/\d+\/live-sets/.test(req.url())) liveSetRequests.push(req.url());
    });

    faults.stop(); // the outage itself is over -- only the frontend's stale state remains
    await page.reload();

    // With no token, boot correctly shows the login screen -- but the STUCK queued write must
    // never have fired a bare/tokenless request while getting there (that's what used to 401 and
    // could tear a freshly-established session right back down).
    await expect(page).toHaveURL(/\/login/);
    expect(liveSetRequests).toHaveLength(0);

    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill('password123');
    await page.getByRole('button', { name: 'Log in' }).click();

    // Logging back in must stick (no bounce back to /login from a replay 401), and the
    // previously-stuck write must now drain for real with a fresh, valid token attached.
    await expect(page).toHaveURL(/\/app\/log/);
    await waitForOutboxDrain(page);
    await expect(page).toHaveURL(/\/app\/log/);
  });

  test('a hard refresh during a server/DB outage holds the session instead of kicking to /login, and recovers once reachable', async ({ page, request }) => {
    await registerHousehold(page, request, 'Marlowe');

    // No snapshot yet to fall back to -- e.g. a fresh profile, or one that just had it cleared.
    await page.evaluate(() => localStorage.removeItem('worktrac-auth-snapshot'));

    // The first two /me attempts fail like a DB-down 500; the third (after the retry backoff)
    // passes through to the real, healthy backend and succeeds.
    await failWithStatus(page, '**/api/auth/me', 500, 2);
    await page.reload();

    // Must hold -- not sign out to /login -- through at least the first retry cycle.
    await page.waitForTimeout(2500);
    await expect(page).not.toHaveURL(/\/login/);

    // Once /me can finally succeed again, the retry loop lands and the app boots in for real.
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/app\/log/);
  });
});
