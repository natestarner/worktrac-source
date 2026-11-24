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
// shown'"). The sampler reads the drawn "Set N" rows on every animation frame from the moment both
// rows are on screen until well after the outbox has drained. The claims, per frame:
//   - never NO rows (bug 2: every queued set dropped off the screen at the remap);
//   - never more than two, and never a value other than the two logged (a duplicate or a stray);
//   - and over the last second of the watch, both -- settled (bug 1 left it stuck at one).
//
// ⚠️ Deliberately NOT "exactly two in every frame". A ONE-frame dip to a single row exists for
// EVERY exercise, library ones included, and predates this spec: when a queued set's save lands
// it leaves the queued list (ExerciseDetail's own mutation-state read) a render before the new
// session id reaches the screen through LogTab's live-session query, so for that render the saved
// set is in neither list. Locally it shows in ~1 run in 75 under parallel load and in most runs
// with the page's CPU slowed 4x -- measured against the code from before this spec's fix too,
// with a library exercise (10 of 12). It is its own follow-up (see the incident doc); asserting it
// here would make this spec flaky on a bug it is not about, and hide the two it is.

const EXERCISE = 'Zercher Squat';
// Keep sampling this long after the outbox drains, so a late refetch that would change the list is
// inside the watch.
const SETTLE_MS = 2500;

// One sample per frame -- "<ms> <row count>: <each row's values>" -- so a failure says which set
// was missing (or doubled), and when.
type RowWatch = { __setRowSamples: string[]; __setRowStop: boolean };

// Counts "Set N" labels in textContent (never innerText -- e2e-tests.md, "An in-page frame
// sampler must read textContent").
async function startRowSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as RowWatch;
    w.__setRowSamples = [];
    w.__setRowStop = false;
    const t0 = performance.now();
    const sample = () => {
      const labels = Array.from(document.querySelectorAll('div')).filter(
        (el) => el.childElementCount === 0 && /^Set \d+$/.test((el.textContent ?? '').trim()),
      );
      const values = labels.map((el) => (el.nextElementSibling?.textContent ?? '').trim());
      return `${Math.round(performance.now() - t0)}ms ${labels.length}: ${values.join(' / ')}`;
    };
    const tick = () => {
      w.__setRowSamples.push(sample());
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

const LOGGED = ['50 lb × 10', '60 lb × 10'];
// The final stretch of the watch that must show both sets, settled.
const SETTLED_MS = 1000;

// The per-frame claims in the header. Failures list the offending frames verbatim.
function expectRowsHeld(samples: string[]) {
  const frames = samples.map((s) => {
    const m = /^(\d+)ms (\d+): ?(.*)$/.exec(s);
    if (!m) throw new Error(`unparseable sample: ${s}`);
    return { raw: s, at: Number(m[1]), count: Number(m[2]), values: m[3] ? m[3].split(' / ') : [] };
  });
  // A sampler that held nothing would make every check below trivially true.
  expect(frames.length).toBeGreaterThan(0);

  expect(frames.filter((f) => f.count === 0).map((f) => f.raw), 'a frame with no sets on screen').toEqual([]);
  expect(
    frames
      .filter((f) => f.count > 2 || new Set(f.values).size !== f.values.length || f.values.some((v) => !LOGGED.includes(v)))
      .map((f) => f.raw),
    'a frame with a duplicate or a value nobody logged',
  ).toEqual([]);

  const end = frames[frames.length - 1].at;
  expect(
    frames.filter((f) => f.at >= end - SETTLED_MS && f.count !== 2).map((f) => f.raw),
    'both sets, once settled',
  ).toEqual([]);
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
      expectRowsHeld(samples);
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
