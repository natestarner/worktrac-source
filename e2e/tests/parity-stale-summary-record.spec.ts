import { Page, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { dismissPrCelebration, pickExercise, setStepperPair } from './support/exercises';
import { delayNetwork } from './support/faults';
import { waitForOutboxDrain } from './support/offline';
import { forEachConnectivityMode } from './support/parity';

// #326: no record may be celebrated against a best that is out of date.
//
// ExerciseDetail's summary is cached under "no live session" between workouts, so the copy it
// paints on the next visit was fetched BEFORE the last workout and is never refreshed when that
// workout ends. Until its refetch lands the record check read that copy: one round trip online, the
// whole retry run in lie-fi. Hard offline and pinned never had it -- the query is paused there, so
// the check already read history. The fix checks the summary's priors against history's
// (exerciseSummaryFromHistory.js#mergeBestWithHistory), which is refreshed after every set.
//
// ⚠️ The summary delay below is the CONDITION UNDER TEST, not a flake workaround. Locally a round
// trip is ~5ms and beats the tap, so without it online passes against the unfixed code; lower's
// ~800ms is what exposed it. Measured on the unfixed code (3 runs per mode): online and lie-fi fail
// every time in both specs, hard-offline and pinned pass. With the fix, all four pass.
const SUMMARY = /\/api\/people\/\d+\/exercises\/\d+\/summary/;
const LOWER_LIKE_LATENCY_MS = 800;

// One ordinary workout of one set, entirely on the server before returning -- so the ONLY stale
// thing in these specs is the cached summary, not a write still in the outbox.
async function workout(page: Page, reps: number) {
  const back = page.getByRole('button', { name: /All exercises/ });
  if (await back.isVisible()) await back.click();
  await pickExercise(page, 'Chin-up');
  await setStepperPair(page, 0, reps);
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(page.getByText(/^Set \d+$/)).toHaveCount(1);
  await dismissPrCelebration(page);
  await waitForOutboxDrain(page);
  await page.getByRole('button', { name: 'End workout' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();
  await expect(page.getByRole('button', { name: 'End workout' })).toHaveCount(0);
  await waitForOutboxDrain(page);
}

async function reopenChinUp(page: Page) {
  const back = page.getByRole('button', { name: /All exercises/ });
  if (await back.isVisible()) await back.click();
  await pickExercise(page, 'Chin-up');
}

async function logReps(page: Page, reps: number) {
  await setStepperPair(page, 0, reps);
  await page.getByRole('button', { name: 'Log set' }).click();
}

// The row first, THEN the overlay. The celebration is decided before the set is written, so once
// the row is on screen the overlay has had its chance -- checking "hidden" straight after the tap
// could pass before the overlay had rendered at all.
async function expectNoRecord(page: Page) {
  await expect(page.getByText(/^Set \d+$/)).toHaveCount(1);
  await expect(page.getByText('New PR!')).toBeHidden();
}

forEachConnectivityMode<Record<string, never>>('no false "first time" record after an ordinary workout', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Stale');
    await workout(page, 10);
    await delayNetwork(page, SUMMARY, LOWER_LIKE_LATENCY_MS);
    return {};
  },
  navigate: reopenChinUp,
  act: (page) => logReps(page, 6),
  assert: expectNoRecord,
});

// The realistic one, and not about "first time" at all. Opening Chin-up at the start of workout 2
// caches the no-live-session summary with a best of 10; nothing refreshes it after the 12. So on the
// third visit it still says 10, and 11 would have been celebrated as a record with 12 on the books.
forEachConnectivityMode<Record<string, never>>('no false record against a best one workout out of date', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Stale');
    await workout(page, 10);
    await workout(page, 12);
    await delayNetwork(page, SUMMARY, LOWER_LIKE_LATENCY_MS);
    return {};
  },
  navigate: reopenChinUp,
  act: (page) => logReps(page, 11),
  assert: expectNoRecord,
});
