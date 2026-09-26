import { test, expect } from '@playwright/test';
import { loginAs, registerHousehold } from './support/auth';
import { pickExercise, logSetAt } from './support/exercises';
import { API_ONLY, failNetwork } from './support/faults';
import { LEGACY_MARKER_WORKOUT, rewritePersistedHistoryAsOldFormat, watchSync } from './support/historyConvergence';

// History is synced a month at a time (lib/historySync.js, WorkoutSessionService#syncHistory): the
// device sends the fingerprint of every month it holds and gets back only the months that changed.
// Unit tests prove the merge; what only a real browser shows is the round trip through a REAL
// persisted cache -- that a reload restores months the server then confirms without resending, and
// that a cache written by a build from before the sync still renders and is then replaced.

test('a reload re-downloads no month that did not change, and a new set re-sends only its own month', async ({ page, request }) => {
  const sync = await watchSync(page);

  await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Barbell Bench Press');
  let mark = await sync.mark();
  await logSetAt(page, 135, 5);
  await sync.persistedSince(mark);

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
  // SCOPED: the sync after the device's own write speaks only for that workout's month (and sends
  // it) -- it neither re-checks nor re-sends any other month the device holds.
  expect(afterSet.some((c) => c.scope?.length === 1 && c.changed.length === 1 && c.changed[0] === c.scope[0])).toBe(true);
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
  const mark = await sync.mark();
  await logSetAt(page, 135, 5);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  await sync.persistedSince(mark);

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
  const sync = await watchSync(page);
  await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Barbell Bench Press');
  const mark = await sync.mark();
  await logSetAt(page, 135, 5);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/135\s?lb\s?×\s?5/).first()).toBeVisible();
  // The rewrite below flattens whatever is on disk, so it must be the History that holds the set.
  await sync.persistedSince(mark);

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
