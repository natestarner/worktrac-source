import { expect, test, type Page, type Route } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { dismissPrCelebration, pickExercise, setStepperPair } from './support/exercises';
import { holdNetwork } from './support/faults';

// Trends opened while the last set is still saving must end up showing that set.
// docs/incidents/2026-09-24-trends-first-load-swallows-invalidation.md
//
// TanStack v5 cancels an in-flight fetch on invalidation only when the query already has data;
// during a FIRST load it joins the request already running. Trends is the one tab not warmed by
// offlineCacheWarm, so opening it is always a first load. The set's invalidation was absorbed, the
// load's answer -- computed before the set existed -- landed and was marked fresh, and Trends said
// "No workouts logged yet" for the full 60s staleTime. On lower that was four specs needing
// retries (trends x3, endurance x1), each one logging a set and opening Trends straight away.
//
// The ORDER is pinned rather than left to timing, because that is the whole bug:
//   1. the set's create is held before it is sent;
//   2. Trends opens, and its overview is answered by the server (no set yet) -- that RESPONSE is
//      held on its way back;
//   3. the create is released and lands, firing the invalidation mid-first-load;
//   4. the stale overview response is released.
// Only the FIRST overview request is held; the refetch the fix issues goes straight through.

async function holdFirstOverviewResponse(page: Page) {
  let answered: () => void = () => {};
  const serverHasAnswered = new Promise<void>((resolve) => { answered = resolve; });
  let deliver: () => void = () => {};
  const delivered = new Promise<void>((resolve) => { deliver = resolve; });
  let first = true;
  await page.route(/\/api\/people\/\d+\/trends\/overview/, async (route: Route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch(); // reaches the server NOW, before the set exists
    answered();
    await delivered;
    await route.fulfill({ response });
  });
  return { serverHasAnswered, release: () => deliver() };
}

test('Trends opened while the last set is still saving ends up showing that set', async ({ page, request }) => {
  await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Chin-up');

  const heldCreate = await holdNetwork(page, /\/api\/people\/\d+\/live-sets$/);
  const overview = await holdFirstOverviewResponse(page);

  await setStepperPair(page, 0, 12);
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(page.getByText(/^Set \d+$/)).toHaveCount(1);
  await dismissPrCelebration(page);
  await expect.poll(() => heldCreate.held()).toBe(1);

  await page.getByRole('link', { name: 'Trends' }).click();
  await overview.serverHasAnswered;

  const createLanded = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/people\/\d+\/live-sets$/.test(r.url()) && r.ok(),
  );
  heldCreate.release();
  await createLanded;
  overview.release();

  // Before the fix this stayed "No workouts logged yet" for the full 60s staleTime.
  await expect(page.getByText('Records · bodyweight')).toBeVisible();
  await expect(page.getByText('No workouts logged yet')).toBeHidden();
});
