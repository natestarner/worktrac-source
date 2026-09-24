import { test, expect, type Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise, logSetAt } from './support/exercises';

// History is fetched with the cached copy's ETag (api/sessions.js#getHistory, HistoryEtagConfig),
// and the one thing unit tests cannot show is a REAL browser's handling of a 304 to a request the
// page tagged itself -- that it reaches the app as a 304 rather than as an error or an empty body.
//
// So: drive a real 304, check the History the person sees afterwards is still complete, then change
// something and check the stale tag gets the new data rather than another 304.

// Every History request as the APP sees it -- what its own fetch() resolved to -- and how many are
// still out. Deliberately not Playwright's network events: WebKit's report a 304 as a 200 carrying
// the 304's headers (measured 2026-09-24; the page itself receives the 304), and Chromium reports a
// 304 whose empty body was never read as net::ERR_ABORTED. The app's view is what this is about.
//
// "Settled" matters because a set's own refetch is routinely cancelled and restarted by the next
// invalidation (TanStack's cancelRefetch), and a restarted request still carries the tag of whatever
// the cache held BEFORE -- so "the next request after X" is not a clean revalidation until the
// earlier ones have finished.
async function watchHistory(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __history: { calls: { status: number; sentTag: string | null }[]; started: number; inFlight: number } };
    w.__history = { calls: [], started: 0, inFlight: 0 };
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!/\/api\/people\/\d+\/history$/.test(new URL(url, location.href).pathname)) return original(input, init);
      const sentTag = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'] ?? null;
      w.__history.started += 1;
      w.__history.inFlight += 1;
      try {
        const response = await original(input, init);
        w.__history.calls.push({ status: response.status, sentTag });
        return response;
      } finally {
        w.__history.inFlight -= 1;
      }
    };
  });
  const read = () =>
    page.evaluate(() => (window as unknown as { __history: { calls: { status: number; sentTag: string | null }[]; started: number; inFlight: number } }).__history);
  return {
    mark: async () => {
      const state = await read();
      return { started: state.started, calls: state.calls.length };
    },
    callsSince: async (mark: { calls: number }) => (await read()).calls.slice(mark.calls),
    // At least one History request began after `mark`, and none are still out.
    settledSince: async (mark: { started: number }) => {
      const state = await read();
      return state.started > mark.started && state.inFlight === 0;
    },
  };
}

test('History revalidates by ETag: unchanged keeps what is shown, changed brings the new set', async ({ page, request }) => {
  const history = await watchHistory(page);

  await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Barbell Bench Press');
  let mark = await history.mark();
  await logSetAt(page, 135, 5);
  await expect.poll(() => history.settledSince(mark)).toBe(true);

  // Back to the exercise list mid-workout refetches History (LogTab). Everything before it has
  // settled and nothing has changed, so this must be a tagged request answered 304.
  mark = await history.mark();
  await page.getByRole('button', { name: '← All exercises' }).click();
  await expect.poll(() => history.settledSince(mark)).toBe(true);
  const revalidations = await history.callsSince(mark);
  expect(revalidations.length).toBeGreaterThan(0);
  expect(revalidations.every((c) => c.status === 304 && !!c.sentTag)).toBe(true);

  // ...and the 304 left History exactly as it was: the set is still there.
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();

  // Now change it. The refetch carries the now-stale tag and must come back 200 with the new set.
  await page.getByRole('link', { name: 'Log' }).click();
  await pickExercise(page, 'Barbell Bench Press');
  mark = await history.mark();
  await logSetAt(page, 155, 3);
  await expect.poll(() => history.settledSince(mark)).toBe(true);
  expect((await history.callsSince(mark)).some((c) => c.status === 200 && !!c.sentTag)).toBe(true);

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/155\s?lb\s?×\s?3/).first()).toBeVisible();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
});
