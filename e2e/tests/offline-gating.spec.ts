import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { goHardOffline, goOnline, outboxCountText } from './support/offline';

// PR 3 of offline mode: the outbox count is surfaced ("N changes waiting to sync"), and online-only
// (Tier 3) actions are gated with OfflineDisabledWrap/useRequireOnline (disabled control + tooltip,
// or a calm "needs a connection" toast) instead of failing outright or, worse, queuing a
// non-idempotent write. These flows don't need the service worker, so they run everywhere.
test.describe('Offline mode — sync-count UX and Tier-3 gating', () => {
  test('the offline banner reports how many changes are waiting to sync', async ({ page, request }) => {
    await registerHousehold(page, request, 'Quinn');
    await pickExercise(page, 'Barbell Bench Press');

    await goHardOffline(page);
    await page.getByRole('button', { name: /Log set/ }).click();

    await expect(outboxCountText(page, 1)).toBeVisible();

    await goOnline(page);
    await expect(page.getByText(/waiting to sync/i)).toBeHidden();
  });

  test('logging a past workout and exporting are disabled offline with a "needs a connection" tooltip', async ({ page, request }) => {
    await registerHousehold(page, request, 'Rowan');

    await page.getByRole('link', { name: 'History' }).click();
    await goHardOffline(page);

    const logPast = page.getByRole('button', { name: '+ Log a past workout' });
    await expect(logPast).toBeDisabled();
    await expect(logPast).toHaveAttribute('title', /needs a connection/i);

    const exportButton = page.getByRole('button', { name: 'Export data' });
    await expect(exportButton).toBeDisabled();
    await expect(exportButton).toHaveAttribute('title', /needs a connection/i);

    await goOnline(page);
    await expect(logPast).toBeEnabled();
  });

  test('adding a person and creating a routine are disabled offline', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sasha');
    await goHardOffline(page);

    const addPerson = page.getByRole('button', { name: '+ Add person' });
    await expect(addPerson).toBeDisabled();
    await expect(addPerson).toHaveAttribute('title', /needs a connection/i);

    await page.getByRole('link', { name: 'Routines' }).click();
    const newRoutine = page.getByRole('button', { name: '+ New routine' });
    await expect(newRoutine).toBeDisabled();
    await expect(newRoutine).toHaveAttribute('title', /needs a connection/i);

    await goOnline(page);
    await expect(addPerson).toBeEnabled();
  });

  test('changing the default unit is disabled offline', async ({ page, request }) => {
    await registerHousehold(page, request, 'Ellis');
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();

    await goHardOffline(page);
    const kgButton = page.getByRole('button', { name: 'kg', exact: true });
    await expect(kgButton).toBeDisabled();
    await expect(kgButton).toHaveAttribute('title', /needs a connection/i);

    await goOnline(page);
    await expect(kgButton).toBeEnabled();
  });
});
