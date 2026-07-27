import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise, addOwnExercise } from './support/exercises';
import { failNetwork, failWithStatus } from './support/faults';
import {
  troubleBanner,
  goOfflineButton,
  offlineSavedLocallyBanner,
  outboxCountText,
  waitForOutboxDrain,
  goHardOffline,
  goOnline,
} from './support/offline';

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
    await expect(page.getByText('No routines yet. Build one from your exercise library.')).toBeVisible();
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
  });

  // Regression test for the bug where creating an exercise and logging a set against it, then
  // finding the backend still unreachable (a real DB outage, not a lost connection), eventually
  // returned a 401 from live-sets and force-logged the user out. Root cause (see
  // GlobalExceptionHandler + queryClient.js): the create's own retries used to give up after a
  // bounded number of attempts without ever recording the temp->real exercise id mapping, so the
  // queued log-set replayed with the raw "temp-exercise-<uuid>" placeholder, which the backend
  // couldn't parse and (before the fix) answered with a session-killing 401 instead of an honest
  // error. Durable writes now retry transient failures forever (never give up for a connectivity
  // reason) and a dependent write refuses to dispatch with an unresolved temp id, so neither half
  // of that chain can fire anymore.
  //
  // The create+log-set is built while genuinely offline (context.setOffline) rather than via a
  // lie-fi route intercept: this worktree's checked-out AddEditExerciseModal only takes the
  // durable/temp-id path when navigator.onLine is false (the "always durable, even while lie-fi"
  // fix lives in a separate, not-yet-merged worktree). Once reconnected with the backend still
  // unreachable, the queued create is RESUMED and starts actively retrying for real (accumulating
  // real failureCount, unlike a paused mutation) -- which is exactly the state that used to run out
  // its retry budget and trigger the bug, regardless of how the mutation got there.
  test('creating an exercise and logging a set, then finding the backend still unreachable after reconnecting, never logs the user out', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sasha');

    await goHardOffline(page);
    await addOwnExercise(page, 'Unreachable Backend Press');
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Logging a set against the just-created (still temp-id) exercise queues right behind the
    // create in the same serial outbox scope.
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(outboxCountText(page, 2)).toBeVisible();

    // Reconnect, but the database is still down -- the queued create resumes and starts actively
    // (not paused) retrying against a dead endpoint.
    const faults = await failNetwork(page, '**/api/exercises');
    await goOnline(page);

    // A few real failing attempts is enough to prove the point -- with the fix there's no retry
    // budget to exhaust, so nothing waits for exhaustion here.
    await page.waitForTimeout(5000);
    await expect(page).toHaveURL(/\/app\//);

    // Once the database recovers, both queued writes replay in order and reconcile to server truth.
    faults.stop();
    await waitForOutboxDrain(page, 30000);
    await expect(page).toHaveURL(/\/app\//);
    await expect(page.getByText('Set 1')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
  });
});
