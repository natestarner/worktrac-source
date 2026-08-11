import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { goHardOffline, goOnline, outboxCountText, waitForOutboxDrain } from './support/offline';

// Mode 3 (elected/hard offline): the rest of the active-workout loop beyond plain set-logging --
// editing/deleting an ALREADY-SYNCED set, favoriting, session notes, and ending the workout --
// is durable too (see queryClient.js's registerOfflineMutationDefaults). Each of these queues in
// the outbox and replays on reconnect exactly like logSet/createExercise (offline-outbox.spec.ts,
// offline-exercise-create.spec.ts).
test.describe('Offline mode — the rest of the active-workout loop', () => {
  test('editing and deleting already-synced sets offline queues both writes and reconciles on reconnect', async ({ page, request }) => {
    await registerHousehold(page, request, 'Blair');
    await pickExercise(page, 'Barbell Bench Press');

    // Two synced sets to work with, logged online.
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(2);

    await goHardOffline(page);

    // Edit the older set's weight (Set 1, bottom row since newest is on top).
    await page.getByRole('button', { name: 'Edit' }).last().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.stepper-row').first().getByRole('button', { name: '+' }).click();
    await dialog.locator('.stepper-row').first().getByRole('button', { name: '+' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    // Delete the newer set (Set 2, top row).
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    // Both writes queued; the edit is reflected immediately (optimistic patch) and the deleted
    // row is gone immediately -- neither waits for a connection.
    await expect(outboxCountText(page, 2)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    // A brand-new exercise has no prefill, and a blank weight logs as 0 (see
    // utils/formulas.js#computePrefillDraft); +5/click on the stepper, clicked twice.
    await expect(page.getByText('10 lb')).toBeVisible();

    await goOnline(page);
    await waitForOutboxDrain(page);

    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await expect(page.getByText('10 lb')).toBeVisible();
  });

  // Editing a set that hasn't synced YET (unlike the already-synced case above) used to remove and
  // re-dispatch its pending create, which could reorder it in the shared outbox scope and, under
  // lie-fi, risked the backend silently discarding the edit (idempotency dedup keyed only on the
  // create's own key). It's now a genuinely separate durable EDIT_SET write targeting the create's
  // temp id (see offlineSetEdits.js/setIdMap.js) -- both writes queue independently and the
  // corrected value is what's actually persisted server-side, not just an optimistic display that
  // could revert.
  test('editing a not-yet-synced set offline queues a separate write and the correction survives reconnect', async ({ page, request }) => {
    await registerHousehold(page, request, 'Rowan');
    await pickExercise(page, 'Barbell Bench Press');

    await goHardOffline(page);

    // Log a set while offline -- its create is queued, not yet synced.
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Edit it before it ever syncs.
    await page.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.stepper-row').first().getByRole('button', { name: '+' }).click();
    await dialog.locator('.stepper-row').first().getByRole('button', { name: '+' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    // Shows the correction immediately, and now TWO writes are queued -- the original create plus
    // the separate edit -- not one replaced mutation.
    await expect(page.getByText('10 lb')).toBeVisible();
    await expect(outboxCountText(page, 2)).toBeVisible();

    await goOnline(page);
    await waitForOutboxDrain(page);

    // The corrected value is what actually landed server-side -- if the edit had been silently
    // dropped (the bug this fixes), a refetch here would have reverted to the original 0 lb.
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await expect(page.getByText('10 lb')).toBeVisible();
    await page.reload();
    await expect(page.getByText('10 lb')).toBeVisible();
  });

  test('favoriting and saving a session note offline both queue and land on reconnect', async ({ page, request }) => {
    await registerHousehold(page, request, 'Cameron');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    await goHardOffline(page);

    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();

    await page.getByRole('button', { name: 'Add a note for this session' }).click();
    await page.getByPlaceholder('Write a note...').fill('Felt strong today');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Felt strong today')).toBeVisible();

    await expect(outboxCountText(page, 2)).toBeVisible();

    await goOnline(page);
    await waitForOutboxDrain(page);

    await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
    await expect(page.getByText('Felt strong today')).toBeVisible();
  });

  test('ending a workout offline clears the live-session dot immediately and stays ended after reconnect', async ({ page, request }) => {
    await registerHousehold(page, request, 'Devon');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    await page.getByRole('button', { name: '← All exercises' }).click();
    await expect(page.getByText(/Session in progress/)).toBeVisible();

    await goHardOffline(page);
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();

    // Optimistic clear happens immediately -- doesn't wait for the write to settle.
    await expect(page.getByText(/Session in progress/)).toBeHidden();
    await expect(outboxCountText(page, 1)).toBeVisible();

    await goOnline(page);
    await waitForOutboxDrain(page);
    await expect(page.getByText(/Session in progress/)).toBeHidden();

    await page.reload();
    await expect(page.getByText(/Session in progress/)).toBeHidden();
  });
});
