import { Page, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise, setHoldSeconds } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// PARITY spec: logging a hold, run across online / lie-fi / hard-offline / pinned-offline from one
// assertion body. Required by the degraded-conditions contract for any user-visible flow.
//
// What makes this worth its own spec rather than a mode of parity-active-loop: a hold's value
// travels a DIFFERENT path from a weight/reps set while degraded. `durationSeconds` has to be
// selected out of the log-set mutation's own variables by pendingBeforeSession's useMutationState
// projection, because contextSessionId stays null for a person's entire outage and the sessionSets
// query therefore never runs. Miss that one field and a hold renders correctly online and blank in
// all three degraded modes -- which is exactly the class of bug this harness exists to catch.
//
// No assertion below branches on ctx.mode. If one ever needs to, that is a real divergence and
// belongs on the register in .claude/rules/resilience.md, not in an `if` here.

const EXERCISE = 'Wall Sit';
const HOLD_SECONDS = 50;

// Exact-matched: the Best card renders the same "0:50" string once this hold is also the longest,
// and a substring match would collide with it. `.first()` is not enough -- the assertion has to be
// about the SET ROW specifically.
const holdRow = (page: Page) => page.getByText('0:50', { exact: true }).first();

// Load the catalog while still online -- ExercisePicker filters client-side over the `exercises`
// query and renders nothing while it is still loading, so a mode entered before the boot warm
// finished would leave the picker permanently empty and this spec would measure the warm race
// rather than the flow. Same reasoning as parity-active-loop's warmCatalog.
async function warmCatalog(page: Page) {
  const search = page.getByPlaceholder('Search all exercises');
  await search.fill(EXERCISE);
  await expect(page.getByRole('button', { name: EXERCISE, exact: true })).toBeVisible();
  await search.fill('');
}

forEachConnectivityMode<void>('a hold logs and reads back as time', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Wexford');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await setHoldSeconds(page, HOLD_SECONDS);
    await page.getByRole('button', { name: 'Log set' }).click();
  },
  assert: async (page) => {
    // The result, not the sync chrome: the person sees their hold, as a time, in every mode.
    await expect(page.getByText('Set 1')).toBeVisible();
    await expect(holdRow(page)).toBeVisible();
    // And never as a rep count -- the failure mode if durationSeconds is dropped anywhere along
    // the way is a row reading "0 lb × 0", not a missing row.
    await expect(page.getByText('0 lb × 0', { exact: true })).toHaveCount(0);
  },
  afterReconnect: async (page) => {
    // The half `assert` cannot see while degraded: that the seconds actually reached the server
    // and came back as seconds, rather than being flattened into reps somewhere in the round trip.
    await expect(holdRow(page)).toBeVisible();
    await expect(page.getByText('Best · Longest hold')).toBeVisible();
  },
});
