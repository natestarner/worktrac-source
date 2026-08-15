import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { delayNetwork } from './support/faults';

const HISTORY_REQUEST = /\/api\/people\/\d+\/history$/;

// Deliberately NOT a parity spec. The refresh indicator is sync chrome, and `e2e-tests.md` is
// explicit that sync chrome legitimately differs by connectivity mode (offline there is no
// background refetch to report at all -- OfflineDataNotice covers that half). What is asserted
// here is a layout property of the online case, which is the only case that renders it.
//
// The claim under test is one that jsdom structurally cannot make: the unit tests in
// RefreshIndicator.test.jsx prove the bar is not in the tab's DOM subtree, but only a real browser
// can prove that nothing MOVED. This measures it -- same element, same viewport coordinates, with
// a refresh running and after it lands.
test.describe('Background-refresh indicator', () => {
  test('reports a refresh from the chrome without moving the content below it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sasha');
    await pickExercise(page, 'Barbell Bench Press');
    // The weight is incidental here (a blank prefill logs as a bodyweight set, which is fine --
    // this spec never compares lifts); all that matters is History having a row to measure.
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/app\/history/);
    const sessionCard = page.getByText('Barbell Bench Press');
    await expect(sessionCard).toBeVisible();

    // The query persister is throttled at 1s, so a reload fired immediately after the fetch boots
    // from a snapshot taken before it. Waiting here is what makes the reload below restore History
    // from cache (paints instantly, refetches in the background) rather than load it cold.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Hold the post-reload revalidation open so the indicator is observably on screen long enough
    // to measure against. The boot cache warm passes { afterRestore: true }, and `history` is one
    // of the refreshAfterRestore keys, so that refetch fires on every reload by design.
    const slowHistory = await delayNetwork(page, HISTORY_REQUEST, 3000);
    await page.reload();

    // Restored from cache, so this is a refetch over data already on screen -- not a first load.
    await expect(page.getByRole('link', { name: 'History' })).toBeVisible();
    await expect(sessionCard).toBeVisible();

    const bar = page.locator('.refresh-indicator-bar');
    await expect(bar).toBeVisible();
    // Where it lives is the fix. In the sticky chrome, absolutely positioned; never a node in the
    // tab panel, which is what an in-flow pill was and why it displaced content.
    await expect(page.locator('.app-chrome .refresh-indicator-bar')).toHaveCount(1);
    await expect(page.locator('.tab-panel .refresh-indicator-bar')).toHaveCount(0);
    // The announcement still rides along in the tab's own tree, for anyone who can't see the bar.
    await expect(page.getByText('Refreshing…', { exact: true })).toHaveCount(1);

    const during = await sessionCard.boundingBox();

    slowHistory.stop();
    // Generous: the request already in flight when stop() was called still serves out its delay.
    await expect(bar).toBeHidden({ timeout: 15000 });
    await expect(page.getByText('Refreshing…', { exact: true })).toHaveCount(0);

    const after = await sessionCard.boundingBox();

    // The whole point. Against the old in-flow pill this differed by ~35px.
    expect(after!.y).toBe(during!.y);
    expect(after!.x).toBe(during!.x);
  });
});
