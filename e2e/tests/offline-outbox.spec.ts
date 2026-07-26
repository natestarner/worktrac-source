import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { goHardOffline, goOnline, outboxCountText, waitForOutboxDrain } from './support/offline';

// PR 2 of offline mode: a set logged with no connection is never lost -- it queues in the durable
// outbox and replays exactly once when connectivity returns (idempotency key prevents a
// double-insert). A paused (offline) write is immediately as durable/editable as a synced one --
// "Saving…" is reserved for a write's very first in-flight attempt, so a paused set shows
// Edit/Delete right away, not a spinner (see ExerciseDetail.jsx's editableTempIds) -- the outbox
// count in the banner is what signals "not yet synced" here, not the row itself.
//
// The across-reload/close durability case (queued write survives a reload or a full browser
// close+reopen while still offline) needs the production service worker to cold-serve the app
// shell, so it lives in offline-durability.spec.ts (run against a preview build), not here.
test.describe('Offline mode — durable set-logging outbox', () => {
  test('a set logged offline queues, then syncs exactly once on reconnect', async ({ page, request }) => {
    await registerHousehold(page, request, 'Casey');
    await pickExercise(page, 'Barbell Bench Press');

    await goHardOffline(page);
    await page.getByRole('button', { name: /Log set/ }).click();

    // Optimistic row is on screen immediately, already editable/deletable (not lost, not
    // errored) -- the banner's outbox count is what says "not yet synced".
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await expect(outboxCountText(page, 1)).toBeVisible();

    await goOnline(page);
    await waitForOutboxDrain(page);

    // Once online it replays and reconciles to a confirmed set, and there is exactly ONE
    // confirmed set row -- no duplicate from the replay.
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await expect(page.getByText('Set 1')).toHaveCount(1);
  });
});
