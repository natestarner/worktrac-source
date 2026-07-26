import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { offlineSavedLocallyBanner, goHardOffline, goOnline } from './support/offline';

// PR 1 of offline mode: the app recognizes offline state. The cold-load-with-no-network case (which
// needs the production service worker, absent in `vite dev`) lives in offline-durability.spec.ts,
// run via `npm run test:pwa` against a preview build instead.
test.describe('Offline mode — shell, boot, and connectivity signal', () => {
  test('shows the offline banner when connectivity drops mid-session and clears when it returns', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'Riley');
    await expect(page).toHaveURL(/\/app\/log/);

    // No banner while online.
    await expect(offlineSavedLocallyBanner(page)).toBeHidden();

    // Lose the connection mid-session -> the banner appears immediately, no reload.
    await goHardOffline(page);
    await expect(offlineSavedLocallyBanner(page)).toBeVisible();

    // Reconnect -> the banner clears on its own.
    await goOnline(page);
    await expect(offlineSavedLocallyBanner(page)).toBeHidden();
  });
});
