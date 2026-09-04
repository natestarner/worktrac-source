import { test, expect, Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// A Free household is told how much more its full history holds, instead of being shown a
// truncated screen that looks complete.
//
// The acute case this closes, which log-past-workout.spec.ts flagged and worked around by forcing
// the household to Pro: log a past workout at an out-of-window date, tap Done, and land on History
// reading "No workouts logged yet" -- about a workout the app had just saved.
//
// Deliberately NO setBillingPlan call anywhere in this file. registerHousehold leaves a household
// on Free, which is the entire subject.

// Comfortably outside any plausible window, and relative to now rather than a date literal so the
// spec cannot age into passing for the wrong reason.
function outOfWindowDate(): string {
  const d = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Drives the real "Log a past workout" flow rather than seeding through the API, for two reasons:
// it is the exact flow the gap was in, and API-seeding behind the app's back leaves the tabs
// rendering an already-warmed empty cache for a minute (see the offlineCacheWarm note in
// .claude/rules/offline-internals.md).
async function logAnOutOfWindowWorkout(page: Page) {
  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('button', { name: '+ Log a past workout' }).click();

  const modal = page.getByRole('dialog');
  await modal.locator('input[type="date"]').fill(outOfWindowDate());
  await modal.locator('input[type="time"]').fill('09:00');
  await modal.getByRole('button', { name: 'Start adding sets' }).click();

  await expect(page).toHaveURL(/\/app\/log/);
  await pickExercise(page, 'Barbell Bench Press');
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(page.getByText('Set 1')).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/app\/history/);
}

const FULL_HISTORY = /Your full history has 1 more workout\./;

test.describe('The Free-tier window names the rest of your history', () => {
  test('warns before the workout is logged, and explains after', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jamie');

    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: '+ Log a past workout' }).click();
    const modal = page.getByRole('dialog');

    // Today is inside the window, so there is nothing to say yet.
    await expect(modal.getByText(/outside the last 90 days/)).toHaveCount(0);

    await modal.locator('input[type="date"]').fill(outOfWindowDate());
    await expect(modal.getByText(/outside the last 90 days, which is what History/)).toBeVisible();

    // ⚠️ WARN, NEVER BLOCK. The workout genuinely is saved and returns on upgrade, so the app must
    // not refuse to record something that actually happened.
    await expect(modal.getByRole('button', { name: 'Start adding sets' })).toBeEnabled();

    await modal.locator('input[type="time"]').fill('09:00');
    await modal.getByRole('button', { name: 'Start adding sets' }).click();

    await expect(page).toHaveURL(/\/app\/log/);
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // THE GAP. This screen used to read "No workouts logged yet for Jamie."
    await expect(page).toHaveURL(/\/app\/history/);
    await expect(page.getByText('No workouts logged yet for Jamie.')).toHaveCount(0);
    await expect(page.getByText(FULL_HISTORY)).toBeVisible();
  });

  test('says so on History, PRs and Trends alike', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jamie');
    await logAnOutOfWindowWorkout(page);

    await expect(page.getByText(FULL_HISTORY)).toBeVisible();

    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByText(FULL_HISTORY)).toBeVisible();
    await expect(page.getByText(/board starts filling in/)).toHaveCount(0);

    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page.getByText(FULL_HISTORY)).toBeVisible();
  });

  test('explains itself on request, and offers the upgrade', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jamie');
    await logAnOutOfWindowWorkout(page);

    // Nothing opens on its own -- the explainer is solicited, never an interstitial.
    await expect(page.getByText(/Nothing is deleted, ever/)).toHaveCount(0);

    await page.getByRole('button', { name: 'About your full history' }).click();

    const explainer = page.getByRole('dialog');
    await expect(explainer.getByText(/Nothing is deleted, ever/)).toBeVisible();
    await expect(explainer.getByText(/free on both plans/)).toBeVisible();

    await explainer.getByRole('button', { name: 'Unlock full history' }).click();
    await expect(page).toHaveURL(/\/app\/billing/);
  });

  // The other exit from that explainer, and the one that was broken. It is a client-side <Link> to
  // /app/help#plan, and React Router does not scroll to a hash -- so this landed on the handbook at
  // the top of a very long page, roughly twelve thousand pixels above the section it names.
  //
  // Asserted here rather than only in help.spec.ts because this is the path someone actually takes:
  // help.spec.ts proves the deep link works, this proves THIS control uses one that resolves.
  test('"How Free and Pro differ" lands on the plan section of the handbook', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'Jamie');
    await logAnOutOfWindowWorkout(page);

    await page.getByRole('button', { name: 'About your full history' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'How Free and Pro differ' }).click();

    await expect(page).toHaveURL(/\/app\/help#plan/);

    const heading = page.getByRole('heading', { name: 'Free and Pro' });
    await expect(heading).toBeVisible();

    const chrome = await page.locator('.app-chrome').boundingBox();
    const box = await heading.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(chrome!.y + chrome!.height);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  // A household with nothing behind the window must see no change anywhere. This is what keeps the
  // notice from being an ad: it only ever appears when it is stating a fact about that person's own
  // data, which for most Free households is never.
  test('stays silent for a household with nothing beyond the window', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jamie');

    for (const tab of ['History', 'PRs', 'Trends']) {
      await page.getByRole('link', { name: tab }).click();
      await expect(page.getByText(/Your full history has/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'About your full history' })).toHaveCount(0);
    }

    // ...and the original empty-state copy is still the honest one here.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('No workouts logged yet for Jamie.')).toBeVisible();
  });
});

// The notice is read from one warmed cache entry by one code path in every mode -- there is no
// connectivity branch behind it, and nothing about it is on resilience.md's register. This is what
// makes that a test result rather than a claim in a comment.
//
// It also guards a specific failure shape: if historyWindow were dropped from offlineCacheWarm, the
// three tabs would go back to looking COMPLETE while degraded -- the same screen saying two
// different things depending on the network, which is exactly what the contract forbids.
forEachConnectivityMode<void>('a Free household is told what its full history holds', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Jamie');
    await logAnOutOfWindowWorkout(page);
    // Read History once online so the count reflects the set just logged before connectivity is
    // taken away. This mirrors real use -- you have seen the tab before you lose signal.
    await expect(page.getByText(FULL_HISTORY)).toBeVisible();
  },
  navigate: async (page) => {
    await page.getByRole('link', { name: 'History' }).click();
  },
  act: async () => {},
  assert: async (page) => {
    // No branch on ctx.mode. That is the parity claim.
    await expect(page.getByText(FULL_HISTORY)).toBeVisible();
    await expect(page.getByRole('button', { name: 'About your full history' })).toBeVisible();
  },
});
