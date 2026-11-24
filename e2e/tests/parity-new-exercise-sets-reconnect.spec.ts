import { expect, Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnExercise, logSetAt } from './support/exercises';
import { delayNetwork } from './support/faults';
import { forEachConnectivityMode } from './support/parity';

// Create an exercise, log two sets on it, reconnect: the exercise screen must show both sets the
// whole way through, and after a reload. docs/incidents/2026-11-24-new-exercise-sets-vanish-on-reconnect.md.
//
// Two bugs, one cause: a set logged against a just-created exercise carries the exercise's TEMP id
// (`temp-exercise-…`), while the screen moves to the real id the moment the create lands.
//  1. LOG_SET's onSettled seeded and invalidated `session-sets(<session>, <temp id>)`, a key nothing
//     reads. The screen's real key was fetched once, between set 1 landing and set 2 landing, held
//     [set 1], and was never told about set 2 -- "Set 1" only, until that cached list went stale
//     and something refetched it (a reload inside that minute restored it as fresh).
//  2. The screen read still-queued sets by a mutation key carrying the exercise id -- the temp one
//     for these sets -- so from the remap until each set landed, they were not drawn at all.
//
// Both only show when the sets land AFTER the create, which is every degraded mode (everything is
// queued, then drains in order) and online whenever the create is still on the wire when a set is
// logged. Online at local speed the create lands first and neither shows; that mode is here to
// prove the fix leaves it alone.
//
// WHY A FRAME SAMPLER: the reconnect is a transient, and bug 2 heals itself once the sets land, so
// a retrying matcher waits it out (e2e-tests.md, "A retrying matcher cannot assert 'this was never
// shown'"). The sampler counts the drawn "Set N" rows on every animation frame from the moment both
// rows are on screen until well after the outbox has drained, and the claim is that every frame
// showed exactly two -- never fewer (a set that vanished), never more (a duplicate).

const EXERCISE = 'Zercher Squat';
// Keep sampling this long after the outbox drains, so a late refetch that would change the list is
// inside the watch.
const SETTLE_MS = 2500;

type RowWatch = { __setRowSamples: number[]; __setRowStop: boolean };

// Counts "Set N" labels in textContent (never innerText -- e2e-tests.md, "An in-page frame
// sampler must read textContent").
async function startRowSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as RowWatch;
    w.__setRowSamples = [];
    w.__setRowStop = false;
    const count = () =>
      Array.from(document.querySelectorAll('div')).filter(
        (el) => el.childElementCount === 0 && /^Set \d+$/.test((el.textContent ?? '').trim()),
      ).length;
    const tick = () => {
      w.__setRowSamples.push(count());
      if (!w.__setRowStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopRowSampler(page: Page) {
  await page.waitForTimeout(SETTLE_MS);
  return page.evaluate(() => {
    const w = window as unknown as RowWatch;
    w.__setRowStop = true;
    return w.__setRowSamples;
  });
}

async function expectBothSets(page: Page) {
  await expect(page.getByText(/^Set \d+$/)).toHaveCount(2);
  await expect(page.getByText('50 lb × 10', { exact: true })).toBeVisible();
  await expect(page.getByText('60 lb × 10', { exact: true })).toBeVisible();
}

function spec(title: string, { slowSetSaves }: { slowSetSaves: boolean }) {
  forEachConnectivityMode<void>(title, {
    setup: async (page, request) => {
      await registerHousehold(page, request, 'Okafor');
      // Lower's ~750ms per write, on the set saves only. That makes the sets land well after the
      // create (and after the screen's set list has been fetched) in every mode, which is the
      // shape both bugs need -- deterministic rather than a local race.
      if (slowSetSaves) await delayNetwork(page, /\/api\/people\/[^/]+\/live-sets/, 750);
    },
    act: async (page) => {
      await addOwnExercise(page, EXERCISE);
      await logSetAt(page, 50, 10);
      await logSetAt(page, 60, 10);
    },
    assert: async (page) => {
      await expectBothSets(page);
      // Started here so it runs through the harness's restore (the reconnect) and the drain.
      await startRowSampler(page);
    },
    afterReconnect: async (page) => {
      const samples = await stopRowSampler(page);
      expect(samples.length).toBeGreaterThan(0);
      expect(samples.filter((n) => n !== 2)).toEqual([]);
      await expectBothSets(page);

      // And after a reload: the persisted copy of the list must hold both too.
      await page.reload();
      await expect(page.getByText(EXERCISE, { exact: true })).toBeVisible();
      await expectBothSets(page);
    },
  });
}

spec('a new exercise keeps both sets through the reconnect', { slowSetSaves: false });
spec('a new exercise keeps both sets through the reconnect, at lower speed', { slowSetSaves: true });
