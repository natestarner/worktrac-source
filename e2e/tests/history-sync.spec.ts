import { test, expect, type Page } from '@playwright/test';
import { loginAs, registerHousehold } from './support/auth';
import { pickExercise, logSetAt } from './support/exercises';
import { waitForQueryCachePersist } from './support/offline';
import { API_ONLY, failNetwork } from './support/faults';
import { LEGACY_MARKER_WORKOUT, rewritePersistedHistoryAsOldFormat } from './support/historyConvergence';

// History is synced a month at a time (lib/historySync.js, WorkoutSessionService#syncHistory): the
// device sends the fingerprint of every month it holds and gets back only the months that changed.
// Unit tests prove the merge; what only a real browser shows is the round trip through a REAL
// persisted cache -- that a reload restores months the server then confirms without resending, and
// that a cache written by a build from before the sync still renders and is then replaced.

type SyncCall = { held: string[]; changed: string[] };

// Every History sync as the APP sees it, and how many are still out. "Settled" matters because a
// set's own refetch is routinely cancelled and restarted by the next invalidation, so "the next sync
// after X" is only meaningful once the earlier ones have finished.
async function watchSync(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __sync: { calls: { held: string[]; changed: string[] }[]; started: number; inFlight: number } };
    w.__sync = { calls: [], started: 0, inFlight: 0 };
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!/\/api\/people\/\d+\/history\/sync$/.test(new URL(url, location.href).pathname)) return original(input, init);
      const held = Object.keys(JSON.parse(String(init?.body ?? '{}')).have ?? {});
      w.__sync.started += 1;
      w.__sync.inFlight += 1;
      try {
        const response = await original(input, init);
        const reply = await response.clone().json().catch(() => ({}));
        w.__sync.calls.push({ held, changed: Object.keys(reply.changed ?? {}) });
        return response;
      } finally {
        w.__sync.inFlight -= 1;
      }
    };
  });
  const read = () =>
    page.evaluate(() => (window as unknown as { __sync: { calls: SyncCall[]; started: number; inFlight: number } }).__sync);
  return {
    // Counters live on the document, so a reload starts them at zero again.
    mark: async () => {
      const state = await read();
      return { started: state.started, calls: state.calls.length };
    },
    callsSince: async (mark: { calls: number }) => (await read()).calls.slice(mark.calls),
    settledSince: async (mark: { started: number }) => {
      const state = await read();
      return state.started > mark.started && state.inFlight === 0;
    },
  };
}

test('a reload re-downloads no month that did not change, and a new set re-sends only its own month', async ({ page, request }) => {
  const sync = await watchSync(page);

  await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Barbell Bench Press');
  let mark = await sync.mark();
  await logSetAt(page, 135, 5);
  await expect.poll(() => sync.settledSince(mark)).toBe(true);
  // The synced shape -- months with fingerprints -- has reached IndexedDB, so the reload restores it.
  await waitForQueryCachePersist(page, '"fullSyncedAt"');

  await page.reload();
  const fresh = { started: 0, calls: 0 };
  await expect.poll(() => sync.settledSince(fresh)).toBe(true);
  const afterReload = await sync.callsSince(fresh);
  // The boot warm revalidates History after every restore, by design. Before the sync that was a
  // full download every single time; now the server confirms each held month and sends nothing.
  expect(afterReload.length).toBeGreaterThan(0);
  expect(afterReload.every((c) => c.held.length > 0 && c.changed.length === 0)).toBe(true);

  // A new set changes exactly one month -- the current one -- and only it comes back. The reload
  // reopened the exercise the person was on (that screen is persisted per person).
  await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
  mark = await sync.mark();
  await logSetAt(page, 155, 3);
  await expect.poll(() => sync.settledSince(mark)).toBe(true);
  const afterSet = await sync.callsSince(mark);
  expect(afterSet.some((c) => c.changed.length === 1)).toBe(true);
  expect(afterSet.every((c) => c.changed.length <= 1)).toBe(true);

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/155\s?lb\s?×\s?3/).first()).toBeVisible();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
});

// Two devices on one account. A change made on the other device is exactly the change this one has
// no write of its own to refresh after -- it is picked up only because the fingerprint of the month
// it touched no longer matches what this device restored. Nothing else could tell it.
test('a set logged on another device reaches this one, resending only its month', async ({ page, request, browser }) => {
  const sync = await watchSync(page);
  const email = await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Barbell Bench Press');
  await logSetAt(page, 135, 5);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  await waitForQueryCachePersist(page, '"fullSyncedAt"');

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await loginAs(other, email, 'password123');
  await pickExercise(other, 'Barbell Bench Press');
  // Both devices are on the same live workout, so this screen also shows the set logged on the
  // first device. Wait for it before logging: logSetAt counts the rows it starts from, and counting
  // before that set has loaded makes the count after look one too many.
  await expect(other.getByText(/^Set \d+$/)).toHaveCount(1);
  await logSetAt(other, 155, 3);
  await otherContext.close();

  await page.reload();
  await expect(page.getByText(/155\s?lb\s?×\s?3/).first()).toBeVisible();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  const fresh = { started: 0, calls: 0 };
  await expect.poll(() => sync.settledSince(fresh)).toBe(true);
  const afterReload = await sync.callsSince(fresh);
  expect(afterReload.some((c) => c.held.length > 0 && c.changed.length === 1)).toBe(true);
});

// The upgrade path (resilience.md, axis D). A device that last ran a build from before the sync has
// History persisted as one flat array. If the server cannot be reached right after the upgrade,
// that array is all there is -- it must still render. Then the first sync that gets through must
// replace it completely.
//
// Not vacuous by construction: the old-format copy carries a marker workout the server has never
// heard of. Seeing it while unreachable proves the old format is what rendered; seeing it GONE after
// proves the sync replaced it rather than merging into it.
//
// Unreachable is lie-fi (API calls fail, pages still load) rather than hard offline, because the dev
// server has no service worker to serve a reload with no network at all -- that half of the contract
// is offline-durability.spec.ts's, under the PWA config. The app's boot path is the same one.
test('History cached by a build from before the sync still shows while unreachable, and the first sync replaces it', async ({ page, request }) => {
  await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Barbell Bench Press');
  await logSetAt(page, 135, 5);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  await waitForQueryCachePersist(page, '"fullSyncedAt"');

  // Step out of the app to a same-origin static file: with no app running, nothing can persist the
  // live cache back over the rewrite, and IndexedDB is per-origin so it is still reachable.
  await page.goto('/boot-watchdog.js');
  await rewritePersistedHistoryAsOldFormat(page, LEGACY_MARKER_WORKOUT);

  const unreachable = await failNetwork(page, API_ONLY);
  await page.goto('/app/history');
  await expect(page.getByText('Legacy Marker Press')).toBeVisible();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();

  // Reachable again. The boot sync of the next load holds nothing it can offer (an old-format copy
  // has no fingerprints), so it asks for everything -- and the marker, which the server never had,
  // is gone.
  unreachable.stop();
  await page.reload();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  await expect(page.getByText('Legacy Marker Press')).toHaveCount(0);
});
