import { expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// The FIRST set of a workout -- the one that implicitly creates the session -- used to appear,
// vanish, and reappear. It left ExerciseDetail's `pendingBeforeSession` the instant the mutation
// reported success, while `contextSessionId` was still null (waiting on a liveSession refetch) and
// `sessionSets` had never been fetched under the just-created session's key. Two sequential round
// trips with an empty list in between, and the "This session" card unmounting and remounting
// around it. LOG_SET's onSettled now reconciles straight from the response instead.
//
// Sets 2+ never had this: `onMutate` has a real session id to write an optimistic row against.
//
// WHY A PER-FRAME SAMPLER, and not `expect(row).toBeVisible()`:
// the row comes back on its own a few hundred milliseconds later, so every auto-retrying matcher
// in Playwright simply waits the bug out and passes. The claim here is about what gets PAINTED
// across a window, which only frame sampling can express. This is the same trap recorded in
// docs/incidents/2026-08-12-prefill-overwrites-typed-weight.md ("a retrying matcher cannot assert
// 'this was never shown'") and the same technique parity-active-loop.spec.ts uses for the
// stale-prefill claim.
//
// WHY IT IS STILL A PARITY SPEC even though the bug is online-only: in the three degraded modes
// the write never succeeds while the assertion runs, so `pendingBeforeSession` holds the row the
// whole time and there is no handoff to get wrong -- those modes pass on unmodified code. That is
// the point. The same prefill incident records the inverse mistake: "A parity spec that only
// checked the offline modes would have concluded there was no bug." Running all four pins down
// that the fix made ONLINE match what degraded already did, without disturbing degraded.

const EXERCISE = 'Barbell Bench Press';

// Matches parity-active-loop.spec.ts: a brand-new exercise has no prefill, a blank weight logs as
// 0 (bodyweight), and reps falls back to 8. The multiplication sign is U+00D7, as rendered by
// formatSetSpaced.
const ROW_LABEL = '0 lb × 8';

// See parity-active-loop.spec.ts -- the picker filters CLIENT-SIDE over the single `exercises`
// query, so a mode entered before the boot warm finished leaves it permanently empty. Pay that
// online and explicitly, or the test measures the warm race instead of the flow.
async function warmCatalog(page: import('@playwright/test').Page) {
  const search = page.getByPlaceholder('Search all exercises');
  await search.fill(EXERCISE);
  await expect(page.getByRole('button', { name: EXERCISE, exact: true })).toBeVisible();
  await search.fill('');
}

forEachConnectivityMode<void>('the first set of a workout never blinks out', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Halloway');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page, _state, ctx) => {
    // Install the sampler BEFORE the tap. Nothing has been logged yet in any mode -- this is a
    // freshly registered household on its first exercise -- so every non-zero sample below
    // necessarily belongs to the set this spec logs.
    await page.evaluate((label) => {
      const samples: number[] = [];
      (window as unknown as Record<string, unknown>).__rowSamples = samples;
      const sample = () => {
        // Count only LEAF divs: the row's value lives in its own text-node-only div, while every
        // ancestor (the row, the card, the column) also has that string in its textContent and
        // would inflate the count into a false duplicate.
        let n = 0;
        document.querySelectorAll('div').forEach((el) => {
          if (el.childElementCount === 0 && el.textContent === label) n += 1;
        });
        samples.push(n);
        (window as unknown as Record<string, unknown>).__rowSampler = requestAnimationFrame(sample);
      };
      sample();
    }, ROW_LABEL);

    await page.getByRole('button', { name: /Log set/ }).click();

    // Hold the sampler open past the point where the write settles and the reconciliation lands.
    // In the degraded modes nothing settles at all, so this is simply a quiet window there; online
    // it is the exact window the row used to disappear in.
    await expect(page.getByText('Set 1', { exact: true })).toHaveCount(1);
    await page.waitForTimeout(ctx.degraded ? 1500 : 3000);
  },
  assert: async (page) => {
    // The row is present at the end, in every mode.
    await expect(page.getByText(ROW_LABEL, { exact: true })).toBeVisible();

    const samples: number[] = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      cancelAnimationFrame(w.__rowSampler as number);
      return w.__rowSamples as number[];
    });

    // The sampler must have actually run and actually seen the row, or the two assertions below
    // are vacuous -- a spec that sampled nothing would "pass" them both.
    expect(samples.length).toBeGreaterThan(10);
    const first = samples.indexOf(1);
    expect(first, 'the set row was never painted at all').toBeGreaterThanOrEqual(0);

    // 1. It never disappeared after first appearing. This is the reported bug.
    const afterFirst = samples.slice(first);
    const blankFrames = afterFirst.filter((n) => n === 0).length;
    expect(blankFrames, `set row blinked out for ${blankFrames} frame(s): ${samples.join(',')}`).toBe(0);

    // 2. It was never painted twice. The reconciliation seeds a confirmed row into `sessionSets`
    //    while the pending row may still be in `pendingBeforeSession`; if the two failed to match
    //    each other the same set would render as both "Set 1" and "Set 2".
    const maxRows = Math.max(...samples);
    expect(maxRows, `set row was painted more than once: ${samples.join(',')}`).toBe(1);
  },
  afterReconnect: async (page) => {
    // One row, one set, after the queued write drains -- no duplicate from the replay path.
    await expect(page.getByText(ROW_LABEL, { exact: true })).toHaveCount(1);
    await expect(page.getByText('Set 1', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Set 2', { exact: true })).toHaveCount(0);
  },
});
