import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnExercise, pickExercise } from './support/exercises';
import { API_ONLY, failNetwork } from './support/faults';
import { offlineSavedLocallyBanner, outboxCountText } from './support/offline';

// Mode 3 durability: a cold app-shell load with no network at all, and a queued write surviving a
// full page reload while still offline. Both depend on the production service worker precaching
// the app shell (disabled in `vite dev` -- see frontend/vite.config.js), so this spec runs ONLY via
// `npm run test:pwa` (playwright.pwa.config.ts) against a preview build, never the fast default
// project (see playwright.config.ts's testIgnore).
test.describe('Offline mode — durability across reload and cold boot (PWA/preview only)', () => {
  test('cold-loads from cache and boots the saved session while fully offline', async ({ page, request }) => {
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
    await expect(offlineSavedLocallyBanner(page)).toBeVisible();
    // The person from the snapshot renders -- proof we booted an authenticated session offline.
    await expect(page.locator('.person-pill-bar').getByRole('button', { name: /Jordan/ })).toBeVisible();

    await page.context().setOffline(false);
  });

  test('a queued set survives a reload while still offline, then syncs on reconnect', async ({ page, request }) => {
    await registerHousehold(page, request, 'Morgan');
    await pickExercise(page, 'Barbell Bench Press');
    // Confirm the exercise selection actually landed (and had a moment to persist to
    // IndexedDB -- AppStateContext writes on every dispatch, but that write is async) before
    // reloading, or the reload below can race it and land back on the picker instead.
    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();

    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });
    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();

    await page.context().setOffline(true);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    // Kill + reopen the app while STILL offline: the queued write must survive in the durable
    // IndexedDB outbox regardless of which screen re-renders first (the exercise selection itself,
    // AppStateContext, and the exercise catalog's own persisted query cache may not have flushed to
    // IndexedDB before this reload -- both are covered elsewhere, e.g. reload-persistence.spec.ts;
    // this test is specifically about the write). The outbox detail list proves it by content, not
    // just count.
    await page.reload();
    const outboxLink = page.getByRole('button', { name: /1 change waiting to sync/i });
    await expect(outboxLink).toBeVisible();
    await outboxLink.click();
    await expect(page.getByText(/logged 45 lb × 8/i)).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    // Reconnect -- the outbox drains on its own (no duplicate-insert re-check here; that's
    // covered thoroughly by the fast suite's offline-outbox.spec.ts, which isn't fighting this
    // spec's SW/catalog-cache timing).
    await page.context().setOffline(false);
    await expect(page.getByText(/waiting to sync/i)).toBeHidden({ timeout: 15000 });
  });

  // Regression test for the reported production incident: create an exercise while lie-fi (the
  // request keeps failing/retrying, but navigator.onLine stays true, so this write is never
  // "paused"), then genuinely go offline before logging the dependent set (so THAT write IS
  // paused) and reload while still offline -- needs the SW-precached shell like the durability
  // tests above, since a real `setOffline(true)` blocks the page's own reload in plain `vite dev`.
  // Before the fix, restoreOutbox registered every paused write ahead of every not-paused one on
  // restore, regardless of true submit order, so the paused, later-submitted log-set could end up
  // ahead of the earlier, still-retrying create it depends on -- and because a write that keeps
  // throwing (an unresolved temp exercise id) never settles, that permanently deadlocked the WHOLE
  // outbox, not just the misordered pair, matching the reported "nothing could sync" symptom. This
  // is a real-browser durability check on top of the deterministic unit coverage in
  // frontend/src/lib/offlineExerciseCreate.test.js and outboxPersistence.test.js, which control the
  // paused/not-paused timing exactly; here it depends on winning a real (if generous) retry-backoff
  // race, so the assertions below hold regardless of exactly when the create's own retry loop
  // happens to flip to paused -- the invariant that matters is "never permanently stuck", not the
  // precise interleaving.
  // Ending a workout clears the liveSession cache entry, but the persister's write is throttled
  // (1s default), so a reload landing inside that window boots from a snapshot taken BEFORE the
  // end. The restored session carries a REAL id -- unlike the `{ id: null }` offline placeholder
  // contextSessionId is built to ignore -- so the finished session gets treated as live and its
  // still-cached sets render under "This session". See
  // docs/incidents/2026-08-08-ended-workout-resurrected-by-persisted-cache.md.
  //
  // NOTE this does NOT deterministically reproduce that race -- whether the reload beats the
  // throttled persist is a matter of timing, and locally the persist usually wins, so this spec
  // passes with or without the endedSessions guard. It is kept for the end-to-end property it does
  // pin ("an ended workout stays ended across a reload, through the real service worker"). The
  // guard itself is covered deterministically in frontend/src/hooks/useLiveSession.test.jsx, which
  // forces the pre-end snapshot via a dehydrate/hydrate round trip and genuinely fails without it.
  test('an ended workout stays ended across a reload, instead of resurfacing as "This session"', async ({ page, request }) => {
    await registerHousehold(page, request, 'Quinn');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });

    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();

    // Reload IMMEDIATELY -- inside the persister's throttle window, which is exactly what a silent
    // tryForceUpdate does after a deploy. Deliberately no wait: waiting is what hid this.
    await page.reload();

    // Offline, so nothing can refetch liveSession and quietly paper over a stale restore.
    await page.context().setOffline(true);

    // Assert the two liveSession-driven signals directly rather than navigating to the exercise
    // screen: reaching it needs the exercise catalog, which an immediate reload hasn't re-warmed,
    // and that would make this spec fail for a reason unrelated to what it's testing. If
    // liveSession is suppressed here, contextSessionId is null and the ended session's cached
    // sets cannot reach "This session" -- that leak is downstream of exactly this value.
    await expect(page.getByText(/Session in progress/)).toBeHidden();
    // The person pill's live-session dot is the other consumer of the same query (a second span
    // appears only while a session is live -- same signal offline-reads.spec.ts uses).
    await expect(page.locator('.person-pill-bar').getByRole('button', { name: /Quinn/ }).locator('span')).toHaveCount(1);

    await page.context().setOffline(false);
  });

  test('create-then-log-set survives a reload mid-lie-fi without the outbox permanently deadlocking', async ({ page, request }) => {
    await registerHousehold(page, request, 'Reload Lie-fi');
    await expect(page).toHaveURL(/\/app\/log/);

    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });

    const faults = await failNetwork(page, API_ONLY);
    await addOwnExercise(page, 'Reload Regression Press');
    await expect(outboxCountText(page, 1)).toBeVisible();
    // Navigating to the new exercise's detail screen (LogTab's handleExerciseCreated) awaits a
    // catalog/picker refetch first, which under lie-fi only settles after its own retry backoff.
    // Must wait for that to actually finish (the "Log set" button appearing) before going
    // genuinely offline below: flipping offline while that refetch is still mid-retry pauses it
    // indefinitely (same networkMode as a write), hanging navigation instead of taking a few
    // seconds.
    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible({ timeout: 15000 });

    // Genuinely offline for the dependent set -- submitted after the create, landing in the
    // opposite (paused) cohort if the create's own retry hasn't also flipped to paused yet.
    await page.context().setOffline(true);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(outboxCountText(page, 2)).toBeVisible();

    await page.reload();
    await expect(outboxCountText(page, 2)).toBeVisible();

    // Real connectivity returns for both.
    faults.stop();
    await page.context().setOffline(false);

    await expect(page.getByText(/waiting to sync/i)).toBeHidden({ timeout: 30000 });
    await expect(page.getByText('Reload Regression Press')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
  });
});
