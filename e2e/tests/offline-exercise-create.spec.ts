import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnExercise } from './support/exercises';
import { goHardOffline, goOnline, outboxCountText, waitForOutboxDrain } from './support/offline';

// PR 4 of offline mode: create a brand-new exercise AND log sets against it with no connection, then
// have it all sync -- the exercise created once (idempotency key) and the sets attached to the real
// server exercise (temp-id -> real-id resolution on replay).
test.describe('Offline mode — create an exercise and log against it', () => {
  test('creates an exercise and logs a set against it offline, then syncs on reconnect', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sky');

    await goHardOffline(page);
    // Create the exercise offline -- opens its detail screen on a temp id.
    await addOwnExercise(page, 'Zercher Squat');
    await expect(page.getByText('Zercher Squat')).toBeVisible();

    // Log a set against the not-yet-synced exercise; both the create and the set are now queued
    // (already editable/deletable -- see offline-outbox.spec.ts's note on paused rows).
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(outboxCountText(page, 2)).toBeVisible();

    // Reconnect: the create replays first, then the set against the real exercise. The selection
    // migrates temp -> real, so the set shows as confirmed (Edit/Delete) with no duplicate.
    await goOnline(page);
    await waitForOutboxDrain(page);
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    // The exercise is now in History exactly once, proving it synced as a real server exercise.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Zercher Squat')).toHaveCount(1);
  });
});
