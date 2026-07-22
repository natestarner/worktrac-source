import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// PR 3 of offline mode: the outbox count is surfaced ("N changes waiting to sync"), and online-only
// (Tier 3) actions are gated with a calm "needs a connection" message instead of failing or, worse,
// queuing a non-idempotent write. These flows don't need the service worker, so they run everywhere.
test.describe('Offline mode — sync-count UX and Tier-3 gating', () => {
  test('the offline banner reports how many changes are waiting to sync', async ({ page, request }) => {
    await registerHousehold(page, request, 'Quinn');
    await pickExercise(page, 'Barbell Bench Press');

    await page.context().setOffline(true);
    await page.getByRole('button', { name: /Log set/ }).click();

    await expect(page.getByText(/1 change waiting to sync/i)).toBeVisible();

    await page.context().setOffline(false);
    await expect(page.getByText(/waiting to sync/i)).toBeHidden();
  });

  test('logging a past workout is blocked offline with a "needs a connection" message', async ({ page, request }) => {
    await registerHousehold(page, request, 'Rowan');

    await page.getByRole('link', { name: 'History' }).click();
    await page.context().setOffline(true);
    await page.getByRole('button', { name: '+ Log a past workout' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/needs a connection/i)).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Start adding sets' })).toBeDisabled();

    await page.context().setOffline(false);
  });
});
