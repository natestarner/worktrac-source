import { expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { forEachConnectivityMode } from './support/parity';

// Creating your own exercise must land you on its detail screen, ready to log a set. That is the
// entire point of the "+ Add your own exercise" button: you tapped it mid-workout because you are
// about to do the thing.
//
// It stopped doing that while ONLINE. AddEditExerciseModal has handed `onSaved` an optimistic temp
// row since #95 -- even while genuinely online, so Save can never hang against a dead-but-reachable
// backend -- but LogTab's handleExerciseCreated still awaited an invalidation of
// queryKeys.exercises() and queryKeys.personExercises() before selecting it. Those are the exact
// two keys insertOptimisticExercise had just written the new exercise into, so online the refetch
// came back with server data containing no temp row, the row was evicted milliseconds before
// selectExercise named it, and selectedExercise resolved to null -- dropping the person back on the
// picker. See docs/incidents/2026-08-19-exercise-create-navigation-lost-online.md.
//
// WHY A PARITY SPEC FOR AN ONLINE-ONLY BUG -- the same reasoning parity-first-set.spec.ts records.
// Offline and pinned-offline, `invalidateQueries` on a paused query resolves immediately without
// fetching, so the temp row survived and the flow always worked; under lie-fi the refetch failed
// and kept its data, so it also worked, just after tens of seconds of retry backoff. Every existing
// spec that creates an exercise (offline-exercise-create, intermittent-errors) therefore ran in a
// mode where the bug is invisible, and there was no online coverage at all. That gap is why this
// survived ten PRs. Running all four modes is what pins down that the fix made ONLINE match what
// degraded already did, without disturbing degraded.
//
// Verified non-vacuous: restoring the awaited refetch fails [online] while the other three pass.

const EXERCISE = 'Zercher Squat';

// How long after the dialog closes the picker must stay unpainted. Covers lower's ~800ms round trip
// (the online bug evicted the new exercise when the refetch landed) with room to spare.
const PICKER_WATCH_MS = 2000;
type PickerWatch = { __pickerSamples: number[]; __pickerDone: boolean };

forEachConnectivityMode<void>('creating an exercise opens its detail screen', {
  critical: true,
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Halloway');
  },
  act: async (page) => {
    // Inlined rather than addOwnExercise(), because the frame sampler has to be installed between
    // opening the dialog and submitting it.
    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill(EXERCISE);

    // WHY A PER-FRAME SAMPLER, and not `expect(picker).toBeHidden()`: the app RECOVERS from this
    // bug on its own. Once the create syncs, LogTab's mutation-cache subscriber remaps the
    // selection from the temp id to the real one and the detail screen appears -- so every
    // auto-retrying Playwright matcher simply waits the bug out and passes. Verified: the first
    // cut of this spec passed all four modes against the reintroduced bug. Same trap as
    // parity-first-set.spec.ts and docs/incidents/2026-08-12-prefill-overwrites-typed-weight.md --
    // a retrying matcher cannot express "this was never painted".
    //
    // (The recovery is not reliable either, which is the reported symptom: the remap is
    // conditioned on `selectedExerciseId === tempId` at the instant the success event fires, and
    // online the create can settle BEFORE the awaited refetch lets selectExercise run -- in which
    // case nothing ever migrates and the person is stuck on the picker for good.)
    //
    // Frames are only counted once the dialog has closed; before that the picker is legitimately
    // still mounted behind it. They are counted for a fixed TIME after that (PICKER_WATCH_MS), not
    // a number of frames: see `assert` for why.
    await page.evaluate((watchMs) => {
      const w = window as unknown as PickerWatch;
      const samples: number[] = [];
      w.__pickerSamples = samples;
      w.__pickerDone = false;
      let firstClosedFrame: number | null = null;
      const tick = () => {
        if (!document.querySelector('[role="dialog"]')) {
          firstClosedFrame ??= performance.now();
          samples.push(document.querySelector('input[placeholder="Search all exercises"]') ? 1 : 0);
        }
        if (firstClosedFrame !== null && performance.now() - firstClosedFrame >= watchMs) w.__pickerDone = true;
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, PICKER_WATCH_MS);

    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();
  },
  assert: async (page) => {
    // The detail screen, not the picker. Deliberately mode-independent -- offline the exercise is
    // still a temp id whose create is queued, and that must be just as loggable as a synced one.
    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();
    // The title is a styled div rather than a heading, so match its exact text (the same way
    // offline-exercise-create.spec.ts does). `exact` matters: the detail screen also carries the
    // name inside aria-labels, and a substring match would go strict-mode on a second element
    // the moment one of those becomes visible text.
    await expect(page.getByText(EXERCISE, { exact: true })).toBeVisible();

    // The real claim: the picker was never painted after the dialog closed. `> 0` guards the
    // sampler itself -- zero samples would make the next assertion trivially true.
    //
    // Wait for the whole watch first. This used to read the samples the moment the detail screen
    // showed, which in WebKit was ONE frame after the dialog closed (it drew a frame every ~60ms
    // locally, and the detail screen is instant when nothing waits on the network). On a busy
    // runner that one frame had sometimes not happened yet: zero samples, and the guard failed in
    // the nightly WebKit run on lower, in a degraded mode, most nights from 2026-11-18. With frames
    // slowed to 300ms locally the old read failed 12/16. It also meant the claim covered a single
    // frame. Now it covers the whole PICKER_WATCH_MS, whatever the frame rate.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as PickerWatch).__pickerDone), {
        timeout: PICKER_WATCH_MS + 10000,
      })
      .toBe(true);
    const samples = await page.evaluate(() => (window as unknown as PickerWatch).__pickerSamples);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.filter((n) => n === 1)).toEqual([]);
  },
  afterReconnect: async (page) => {
    // Still on the same exercise once the create has synced and the selection has migrated from the
    // temp id to the real one -- not bounced back to the picker when the temp row leaves the cache.
    await expect(page.getByText(EXERCISE, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();
  },
});
