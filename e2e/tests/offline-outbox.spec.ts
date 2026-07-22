import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// PR 2 of offline mode: a set logged with no connection is never lost -- it queues in the durable
// outbox, shows "will sync", and replays exactly once when connectivity returns (idempotency key
// prevents a double-insert).
test.describe('Offline mode — durable set-logging outbox', () => {
  test('a set logged offline queues, then syncs exactly once on reconnect', async ({ page, request }) => {
    await registerHousehold(page, request, 'Casey');
    await pickExercise(page, 'Barbell Bench Press');

    await page.context().setOffline(true);
    await page.getByRole('button', { name: /Log set/ }).click();

    // Optimistic row is on screen immediately, flagged as queued -- not lost, not errored.
    await expect(page.getByText(/Will sync once you're back online/i)).toBeVisible();

    await page.context().setOffline(false);

    // Once online it replays and reconciles to a confirmed set (Edit/Delete controls appear), and
    // there is exactly ONE set row -- no duplicate from the replay.
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByText(/Will sync once you're back online/i)).toBeHidden();
    await expect(page.getByText('135 lb × 8')).toHaveCount(1);
  });

  // The across-reload durability needs the production service worker (to cold-serve the shell while
  // offline) + the persisted caches, so this runs against the deployed target only.
  test('a queued set survives a reload while still offline, then syncs on reconnect', async ({ page, request }) => {
    test.skip(
      !process.env.E2E_BASE_URL,
      'reload-while-offline requires the production service worker, absent in local vite dev',
    );

    await registerHousehold(page, request, 'Morgan');
    await pickExercise(page, 'Barbell Bench Press');

    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 });

    await page.context().setOffline(true);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByText(/Will sync once you're back online/i)).toBeVisible();

    // Kill + reopen the app while STILL offline: the queued write must survive (durable outbox) and
    // the optimistic row must still be shown as pending.
    await page.reload();
    await expect(page.getByText(/Will sync once you're back online/i)).toBeVisible();

    await page.context().setOffline(false);
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByText('135 lb × 8')).toHaveCount(1);
  });
});
