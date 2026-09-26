import { expect, test, type Page, type Route } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { logSetAt, pickExercise } from './support/exercises';

// The PRs board must show a set that landed while its FIRST load -- the boot cache warm -- was in
// flight. The same TanStack v5 behaviour as docs/incidents/2026-09-24-trends-first-load-swallows-
// invalidation.md, reached from the warm rather than from opening a tab: an invalidation cancels an
// in-flight fetch only when the query already has data, so during a first load it is absorbed, and
// the load's answer -- computed before the set existed -- lands and is marked fresh for the whole
// staleTime. On lower that was parity-pr-record and both offline-reads PRs specs needing retries,
// each showing "No PRs yet" or a board missing the set just logged.
//
// The ORDER is pinned rather than left to timing:
//   1. the boot warm's `prs` request reaches the server before any set exists, and its RESPONSE is
//      held on the way back;
//   2. a set is logged and lands, firing the invalidation mid-first-load;
//   3. the stale response is released;
//   4. the PRs tab opens.
// Only the first `prs` request is held; anything the fix issues afterwards goes straight through.

async function holdFirstPrsResponse(page: Page) {
  let answered: () => void = () => {};
  const serverHasAnswered = new Promise<void>((resolve) => { answered = resolve; });
  let deliver: () => void = () => {};
  const delivered = new Promise<void>((resolve) => { deliver = resolve; });
  let first = true;
  await page.route(/\/api\/people\/\d+\/prs$/, async (route: Route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch(); // reaches the server NOW, before the set exists
    answered();
    await delivered;
    // The fix cancels this request in the browser, so there may be nobody left to answer.
    await route.fulfill({ response }).catch(() => {});
  });
  return { serverHasAnswered, release: () => deliver() };
}

test('a set that lands while the PRs warm is in flight is on the PRs board', async ({ page, request }) => {
  const warm = await holdFirstPrsResponse(page);
  await registerHousehold(page, request, 'Nate');
  await warm.serverHasAnswered;

  await pickExercise(page, 'Barbell Bench Press');
  const setLanded = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/people\/\d+\/live-sets$/.test(r.url()) && r.ok(),
  );
  await logSetAt(page, 135, 5);
  await setLanded;
  warm.release();

  await page.getByRole('link', { name: 'PRs' }).click();
  await expect(page).toHaveURL(/\/app\/prs/);
  // Before the fix this read "No PRs yet" for the full 60s staleTime.
  await expect(page.getByTestId('pr-row').first()).toContainText('Barbell Bench Press');
  await expect(page.getByText('No PRs yet')).toBeHidden();
});
