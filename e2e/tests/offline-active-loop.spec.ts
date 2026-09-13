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

  // THE reported bug, end to end. Editing a not-yet-synced set queues a separate EDIT_SET against
  // the create's temp id; deleting that set then cancelled only the CREATE, leaving the edit
  // pointing at an id nothing would ever map. On reconnect it retried forever, and because every
  // durable write shares one serial mutation scope, a write stuck in 'pending' never releases it --
  // so nothing queued behind it ever synced again, including sets logged later while fully online.
  //
  // The assertion that matters is the LAST one: a set logged after reconnecting has to reach the
  // server. "The edit is stuck" and "the app no longer syncs anything" were the same bug.
  // docs/incidents/2026-09-04-outbox-wedged-by-orphaned-edit.md
  test('editing then deleting a not-yet-synced set leaves nothing stuck, and later writes still sync', async ({ page, request }) => {
    await registerHousehold(page, request, 'Quinn');
    await pickExercise(page, 'Barbell Bench Press');

    await goHardOffline(page);

    // Log a set offline, correct it, then delete it -- all before anything syncs.
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.stepper-row').first().getByRole('button', { name: '+' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(outboxCountText(page, 2)).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    // The set is gone from the screen AND its correction is gone from the sync list. Leaving the
    // edit listed was the visible half of the report: "the edit record still shows in the syncing
    // list, but the set was removed."
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByText(/waiting to sync/)).toBeHidden();

    await goOnline(page);
    await waitForOutboxDrain(page);

    // The queue is genuinely usable again -- this is the assertion the bug actually broke.
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await waitForOutboxDrain(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
  });

  // The escape hatch. Even with the wedge fixed, a person who believes their queue is stuck needs a
  // way out that is not "log out and lose the session too".
  test('the sync list can be cleared by hand, and the app keeps working afterwards', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sasha');
    await pickExercise(page, 'Barbell Bench Press');

    await goHardOffline(page);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();

    await page.getByRole('button', { name: /waiting to sync/ }).click();
    await expect(page.getByText('Waiting to sync (1)')).toBeVisible();

    // Destructive, so it confirms first rather than firing on the tap.
    await page.getByRole('button', { name: 'Clear all queued changes' }).click();
    await expect(page.getByText(/Discard 1 change that hasn't synced yet/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByText(/waiting to sync/)).toBeHidden();

    // And the outbox still works: a set logged after the clear syncs normally on reconnect.
    await goOnline(page);
    await page.getByRole('button', { name: /Log set/ }).click();
    await waitForOutboxDrain(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);
  });
});
