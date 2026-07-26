import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';

// Proactive prefetch (offlineCacheWarm.js / useOfflineCacheWarming.js): the app quietly warms
// every household member's logging-essentials data in the background, not just whichever
// person/tab is on screen, so a device hand-off mid-outage (a sibling grabs the iPad) still has
// something to render instead of a screen that never resolves.
test.describe('Offline cache warming — unvisited person/tab', () => {
  test('a newly added person\'s History resolves while offline, even though History was never visited for them', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'Alex');

    // Adding a person makes them active immediately (on Log), but they never navigate to
    // History -- so History's own useQuery has never mounted for them. Without proactive
    // warming, going offline before ever visiting History would leave that query paused with
    // no cached entry, and the tab would spin on its skeleton forever.
    const historyWarmed = page.waitForResponse((response) => /\/api\/people\/\d+\/history$/.test(response.url()));
    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Jamie');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();

    // Confirm the background warm actually completed before cutting the connection.
    await historyWarmed;

    await page.context().setOffline(true);
    await page.getByRole('link', { name: 'History' }).click();

    // Resolves to the real empty state (proof the query had cached data to read), not stuck
    // showing skeleton placeholders indefinitely.
    await expect(page.getByText('No workouts logged yet for Jamie.')).toBeVisible();

    await page.context().setOffline(false);
  });
});
