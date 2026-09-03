import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise, addOwnExercise } from './support/exercises';
import { API_ONLY, delayNetwork, failNetwork, failWithStatus } from './support/faults';
import { troubleBanner, goOfflineButton, goBackOnlineButton, offlineSavedLocallyBanner, outboxCountText, waitForOutboxDrain } from './support/offline';

// Mode 2: the backend is unreachable or erroring, but the browser is still "online"
// (navigator.onLine never flips) and the user has NOT elected offline mode. Distinct from a real
// dropped connection (context.setOffline) -- these tests intercept requests instead, so
// onlineManager/useOnlineStatus stay `true` throughout, and OfflineDisabledWrap/useRequireOnline
// gating does NOT kick in (that's Mode 3 only -- see offline-gating.spec.ts). The only thing that
// can see this case is reachabilityMonitor (fed from every call in api/client.js), which is what
// ConnectionTroubleBanner is built on.
test.describe('Intermittent connectivity — online but the backend is unreachable/erroring', () => {
  test('shows the connection-trouble banner after repeated network failures, and clears on a real success', async ({ page, request }) => {
    await registerHousehold(page, request, 'Drew');
    await pickExercise(page, 'Barbell Bench Press');

    // A rejected fetch (not a fulfilled 5xx -- see faults.ts) is what reachabilityMonitor counts.
    // The log-set mutation's own retry loop supplies the 3 consecutive failures on its own.
    const faults = await failNetwork(page, '**/api/**');
    await page.getByRole('button', { name: /Log set/ }).click();

    await expect(troubleBanner(page)).toBeVisible({ timeout: 10000 });
    // This is NOT the elected-offline banner -- navigator.onLine never flipped.
    await expect(offlineSavedLocallyBanner(page)).toBeHidden();

    faults.stop();
    await expect(troubleBanner(page)).toBeHidden({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
  });

  test('a set logged during a transient run of 5xx responses retries and lands exactly once, with no trouble banner', async ({ page, request }) => {
    await registerHousehold(page, request, 'Emerson');
    await pickExercise(page, 'Barbell Bench Press');

    // A fulfilled 500 is a completed response -- api/client.js counts that as reachable, so this
    // never trips reachabilityMonitor. It DOES trip the durable outbox's retry-with-backoff.
    await failWithStatus(page, '**/api/people/*/live-sets', 500, 2);
    await page.getByRole('button', { name: /Log set/ }).click();

    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1, { timeout: 20000 });
    await expect(page.getByText('Set 1')).toHaveCount(1);
    await expect(troubleBanner(page)).toBeHidden();
  });

  test('a Tier-3 write does not silently succeed while the backend is erroring, and is not gated (still online)', async ({ page, request }) => {
    await registerHousehold(page, request, 'Rory');
    await page.getByRole('link', { name: 'Routines' }).click();

    const newRoutineButton = page.getByRole('button', { name: '+ New routine' });
    // Not gated -- useRequireOnline/OfflineDisabledWrap only react to navigator.onLine/the pin,
    // neither of which this scenario touches.
    await expect(newRoutineButton).toBeEnabled();
    await newRoutineButton.click();

    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill('Erroring Exercise');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();

    await failWithStatus(page, '**/api/people/*/routines', 500, 999);
    await page.getByRole('button', { name: 'Save routine' }).click();

    // No try/catch around this write (RoutinesTab/RoutineFormModal) -- a real failure leaves the
    // modal open with the form intact, rather than silently creating the routine or losing the
    // user's input.
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    // Title and body are separate elements since this became an EmptyState, so the sentence can no
    // longer be matched as one string.
    await expect(page.getByText('No routines yet.')).toBeVisible();
    await expect(page.getByText('Build one from your exercise library and starting a workout is one tap.')).toBeVisible();
  });

  test('tapping "Go offline" from the trouble banner transitions cleanly into elected offline mode', async ({ page, request }) => {
    await registerHousehold(page, request, 'Toni');
    await pickExercise(page, 'Barbell Bench Press');

    const faults = await failNetwork(page, '**/api/**');
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(troubleBanner(page)).toBeVisible({ timeout: 10000 });

    await goOfflineButton(page).click();
    await expect(troubleBanner(page)).toBeHidden();
    // The already-failing log-set write survives the transition -- it's still queued, now paused
    // (not retrying), rather than the empty-queue "your changes are saved" wording.
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Tier-3 gating now applies -- it only reacts to the elected/hard-offline signal, not "trouble".
    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page.getByRole('button', { name: '+ New routine' })).toBeDisabled();

    faults.stop();
    await page.context().setOffline(false);

    // "Go back online" runs its own probeReachability() check (a real fetch to /actuator/health)
    // before unpinning -- regression coverage for the bug where that probe always failed
    // cross-origin in deployed environments (missing CORS registration on /actuator/health) even
    // though the button's logic and the Settings toggle both drive the exact same pin flag.
    await goBackOnlineButton(page).click();
    await expect(page.getByText(/Still can.t reach the server/)).toBeHidden();
    await expect(page.getByRole('button', { name: '+ New routine' })).toBeEnabled();
  });

  test('creating an exercise while lie-fi closes the dialog immediately instead of hanging, and syncs once reachable', async ({ page, request }) => {
    await registerHousehold(page, request, 'Devon');

    // The bug this covers: the create-exercise modal used to await the network directly whenever
    // navigator.onLine was true (regardless of whether the backend actually answered), so against
    // a dead-but-reachable backend it hung for the full 15s request timeout and then silently
    // failed with the dialog still open. It must now always take the optimistic outbox path, same
    // as real offline, so Save closes right away no matter what onlineManager reports.
    const faults = await failNetwork(page, '**/api/**');
    await addOwnExercise(page, 'Cable Row');

    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 2000 });
    await expect(page.getByText('Cable Row')).toBeVisible();
    await expect(outboxCountText(page, 1)).toBeVisible();

    faults.stop();
    await waitForOutboxDrain(page);
    await page.reload();
    await expect(page.getByText('Cable Row')).toBeVisible();
  });

  test('History and the Log tab\'s session-exercises list still render from cache after a reload while lie-fi', async ({ page, request }) => {
    await registerHousehold(page, request, 'Reagan');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await page.getByRole('button', { name: /All exercises/ }).click();
    await expect(page.getByText('Session exercises')).toBeVisible();

    // Go lie-fi (backend unreachable, browser still reports online) and reload. The static app
    // shell isn't behind this fault (it only matches /api/), so the reload itself succeeds --
    // only API calls fail, same as the dev server being up but the backend container stopped.
    const faults = await failNetwork(page, API_ONLY);
    await page.reload();

    // Both must render from the persisted cache, not get stuck on a skeleton/empty state because
    // an imperative cache-warm prefetch raced the still-hydrating persisted query cache and left
    // history/live-session data-less against the dead backend (see useOfflineCacheWarming.js).
    await expect(page.getByText('Session exercises')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    faults.stop();
  });

  // A lie-fi write is really attempted and really fails, then retries forever with backoff
  // (shouldRetryWrite never gives up on a statusless/5xx failure). Throughout, the Log tab must
  // keep listing its exercise even though the server has no record of the set at all.
  //
  // NOTE this does NOT exercise the terminal-'error' branch of isUnsyncedWrite: because retries
  // are unbounded, a lie-fi write stays 'pending' between backoffs and this spec passes with the
  // old status === 'pending' filter too. Keeping it anyway -- it pins the behaviour that matters
  // to the user. The 'error' branch is covered in useSessionEntries.test.jsx, where the test
  // client uses retry: false.
  test("the Log tab keeps listing an exercise whose set is stuck retrying against a dead backend", async ({ page, request }) => {
    await registerHousehold(page, request, 'Sasha');
    await pickExercise(page, 'Barbell Bench Press');

    // Cut the backend BEFORE logging, so this set never reaches the server at all.
    const faults = await failNetwork(page, API_ONLY);
    await page.getByRole('button', { name: /Log set/ }).click();

    // The row is durable on the exercise screen (Edit/Delete, not an endless spinner) once the
    // write is paused/retrying/errored -- that part already worked.
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    // Wait for the retry loop to genuinely exhaust itself rather than asserting mid-flight: the
    // banner counts it as queued, which is the signal that it is no longer a fresh first attempt.
    await expect(outboxCountText(page, 1)).toBeVisible();

    // The set exists ONLY as a queued mutation -- nothing about it is on the server. The session
    // list must still show its exercise. Scoped to .session-exercises: the same name also appears
    // in the picker and in search results on this screen.
    await page.getByRole('button', { name: /All exercises/ }).click();
    const sessionList = page.locator('.session-exercises');
    await expect(sessionList.getByText('Barbell Bench Press', { exact: true })).toBeVisible();

    // And once it finally syncs it stays listed, now from server truth rather than the outbox.
    faults.stop();
    await waitForOutboxDrain(page);
    await expect(sessionList.getByText('Barbell Bench Press', { exact: true })).toBeVisible();
  });

  test('the outbox list still shows the real exercise name after a reload while lie-fi, not a generic fallback', async ({ page, request }) => {
    await registerHousehold(page, request, 'Skyler');
    await pickExercise(page, 'Barbell Bench Press');

    const faults = await failNetwork(page, API_ONLY);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();

    await page.reload();

    // The write is still queued (the fault route survives the reload) -- open the list and
    // confirm the real name shows. Before the fix, an id-referencing write's name was resolved
    // from the live exercise-catalog query at render time, which is empty/refetching (and hanging
    // here, since it's lie-fi) right after a reload, degrading the label to "an exercise".
    await expect(outboxCountText(page, 1)).toBeVisible();
    await page.getByRole('button', { name: /waiting to sync/ }).click();
    await expect(page.getByRole('dialog').getByText(/Barbell Bench Press/)).toBeVisible();
    await expect(page.getByRole('dialog').getByText('an exercise')).toBeHidden();

    faults.stop();
  });

  // Regression test for the bug where creating an exercise and logging a set against it while the
  // backend was unreachable (a real DB outage, not a lost connection -- navigator.onLine stays true
  // the whole time) eventually returned a 401 from live-sets and force-logged the user out. Root
  // cause (see GlobalExceptionHandler + queryClient.js): the create's own retries used to give up
  // after a bounded number of attempts without ever recording the temp->real exercise id mapping,
  // so the queued log-set replayed with the raw "temp-exercise-<uuid>" placeholder, which the
  // backend couldn't parse and (before the fix) answered with a session-killing 401 instead of an
  // honest error. Durable writes now retry transient failures forever (never give up for a
  // connectivity reason) and a dependent write refuses to dispatch with an unresolved temp id, so
  // neither half of that chain can fire anymore. Now that the create-exercise modal always takes
  // the durable/optimistic path (even while lie-fi -- see the sibling test above), this reproduces
  // with a single continuous lie-fi window, matching the original bug report exactly rather than
  // needing a hard-offline-then-reconnect workaround.
  test('creating an exercise and logging a set against it while the backend is unreachable never logs the user out', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sasha');

    const faults = await failNetwork(page, '**/api/**');
    await addOwnExercise(page, 'Unreachable Backend Press');
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Logging a set against the just-created (still temp-id) exercise queues right behind the
    // create in the same serial outbox scope.
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(outboxCountText(page, 2)).toBeVisible();

    // The core assertion: still on the authenticated app, never bounced to /login, no matter how
    // long the backend stays unreachable. Waiting on a fixed sleep here only proved "no logout
    // within roughly 5s" -- tied to wall-clock time, not to the retry mechanism this test actually
    // guards against. Instead wait for genuine proof that multiple retry attempts have actually
    // hit the faulted endpoints (the exact mechanism a malformed-temp-id retry loop would exercise
    // repeatedly), then assert -- deterministic regardless of how fast or slow retries happen to
    // fire on a given run.
    await expect.poll(() => faults.count(), { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    await expect(page).toHaveURL(/\/app\//);

    // Once the backend recovers, both queued writes replay in order and reconcile to server truth.
    faults.stop();
    await waitForOutboxDrain(page, 30000);
    await expect(page).toHaveURL(/\/app\//);
    await expect(page.getByText('Set 1')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
  });

  // "Slow but alive" (axis A) crossed with "a reload at the worst instant" (axis C) -- the one
  // combination the parity harness cannot reach, because there the write always settles before the
  // reload. A cold-starting lower backend produces it routinely, and nothing else covered it.
  //
  // ⚠️ READ THIS BEFORE TREATING IT AS REGRESSION COVERAGE FOR 2026-08-12: it is not. Verified
  // vacuous for that fix -- it passes with the provisional-session staleTime predicate reverted.
  // The reason is the point: with the write STILL QUEUED at reload time, the outbox replay's
  // LOG_SET onSettled invalidates liveSession by itself, so contextSessionId resolves either way.
  // That is exactly why the original bug needed an EMPTY outbox to bite -- once the write has
  // landed there is no replay left to invalidate anything, and the restored provisional entry's
  // fake freshness is the only thing left deciding. The guard for that lives in
  // parity-active-loop.spec.ts (3 of 4 modes fail without the fix) and useLiveSession.test.jsx.
  //
  // What this DOES pin is the settled state of the fix's one residual risk: the revalidation can
  // now race the replay, and if the GET wins the server answers null (no session yet) and briefly
  // replaces the placeholder -- so the session banner may blink. It must come back, and the set
  // must be listed under it. Deliberately ONLINE: offline and lie-fi cannot show this at all,
  // since the revalidation pauses or fails and the placeholder is retained either way.
  test('a set logged against a slow backend survives a reload taken mid-write', async ({ page, request }) => {
    await registerHousehold(page, request, 'Marlow');
    await pickExercise(page, 'Barbell Bench Press');

    // Slow enough that the write is unambiguously still in flight at reload time, but well under
    // api/client.js's REQUEST_TIMEOUT_MS -- this is a slow backend, not a dead one.
    const slow = await delayNetwork(page, /\/api\/people\/\d+\/live-sets/, 4000);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByText('0 lb × 8', { exact: true })).toBeVisible();

    // Outlast the query persister's 1s throttle so the PROVISIONAL session is what reaches disk --
    // without this the reload restores a snapshot with no liveSession entry and the interesting
    // path never runs (see parity-active-loop.spec.ts's matching wait).
    await page.waitForTimeout(1200);
    await page.reload();

    // The write is replayed from the durable outbox on boot; let it land at normal speed.
    slow.stop();
    await waitForOutboxDrain(page, 30000);

    // Settled state: the session is live again and the set is listed under it -- i.e. the
    // revalidation resolved to the REAL session id rather than leaving contextSessionId null.
    await expect(page.getByText(/Session in progress/)).toBeVisible();
    await expect(page.getByText('0 lb × 8', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(1);
  });
});
