import { expect, test, type Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { dismissPrCelebration, logSetAt, pickExercise, setStepperPair } from './support/exercises';
import { holdNetwork } from './support/faults';

// The PRs board and Trends are built on the device from History, with the workout in progress
// folded in (hooks/useStatsFromHistory.js). So a set is on them the moment it is logged -- while its
// save is still in flight -- and it must NEVER drop off while that save lands and History catches up.
//
// The hand-off is the dangerous moment: the set leaves the queue the instant its save succeeds, but
// History only holds it once the refresh that save triggers lands. It was in neither for that round
// trip, and the screen fell back to "No PRs yet" / "No workouts logged yet" until it did
// (lib/confirmedSets.js). Both waits are held open here so that window is as wide as a slow network
// makes it, and every animation frame is checked -- a retrying matcher would simply wait a blink out.
//
// These replace prs-first-load.spec.ts and trends-first-load.spec.ts, which pinned the same promise
// against the /prs and /trends/overview requests these screens no longer make
// (docs/incidents/2026-09-24-trends-first-load-swallows-invalidation.md).

const LIVE_SET = /\/api\/people\/\d+\/live-sets$/;
const HISTORY_SYNC = /\/api\/people\/\d+\/history\/sync$/;

// Every frame from now until stopped: was the "nothing here" state ever painted?
async function watchForEmpty(page: Page, emptyText: string) {
  await page.evaluate((text) => {
    const w = window as unknown as { __emptySeen: number; __frames: number; __watching: boolean };
    w.__emptySeen = 0;
    w.__frames = 0;
    w.__watching = true;
    const tick = () => {
      if (!w.__watching) return;
      w.__frames += 1;
      // textContent, never innerText -- see .claude/rules/e2e-tests.md.
      if ((document.body.textContent || '').includes(text)) w.__emptySeen += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, emptyText);
  return async () =>
    page.evaluate(() => {
      const w = window as unknown as { __emptySeen: number; __frames: number; __watching: boolean };
      w.__watching = false;
      return { emptySeen: w.__emptySeen, frames: w.__frames };
    });
}

// The set's save held in flight, then released while the History refresh it triggers is held too.
async function landTheSaveWithHistoryHeld(page: Page, heldSave: { release: () => void }) {
  const heldHistory = await holdNetwork(page, HISTORY_SYNC);
  const saveLanded = page.waitForResponse((r) => r.request().method() === 'POST' && LIVE_SET.test(r.url()) && r.ok());
  heldSave.release();
  await saveLanded;
  // The refresh the save triggers has been sent and is parked: the set is in neither the queue nor
  // History right now.
  await expect.poll(() => heldHistory.held()).toBeGreaterThan(0);
  return heldHistory;
}

test('a set is on the PRs board while it saves, and never drops off as History catches up', async ({ page, request }) => {
  await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Barbell Bench Press');
  const heldSave = await holdNetwork(page, LIVE_SET);
  await logSetAt(page, 135, 5);
  await expect.poll(() => heldSave.held()).toBe(1);

  await page.getByRole('link', { name: 'PRs' }).click();
  await expect(page).toHaveURL(/\/app\/prs/);
  // Still saving, and already on the board.
  await expect(page.getByTestId('pr-row').first()).toContainText('Barbell Bench Press');

  const stop = await watchForEmpty(page, 'No PRs yet');
  const heldHistory = await landTheSaveWithHistoryHeld(page, heldSave);
  await expect(page.getByTestId('pr-row').first()).toContainText('Barbell Bench Press');

  const historyLanded = page.waitForResponse((r) => HISTORY_SYNC.test(r.url()) && r.ok());
  heldHistory.release();
  await historyLanded;
  await expect(page.getByTestId('pr-row').first()).toContainText('Barbell Bench Press');
  await expect(page.getByTestId('pr-row')).toHaveCount(1);

  const { emptySeen, frames } = await stop();
  expect(frames).toBeGreaterThan(0);
  expect(emptySeen, 'the board showed "No PRs yet" while the set was saving').toBe(0);
});

test('a set is in Trends while it saves, and never drops off as History catches up', async ({ page, request }) => {
  await registerHousehold(page, request, 'Nate');
  await pickExercise(page, 'Chin-up');
  const heldSave = await holdNetwork(page, LIVE_SET);
  await setStepperPair(page, 0, 12);
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(page.getByText(/^Set \d+$/)).toHaveCount(1);
  await dismissPrCelebration(page);
  await expect.poll(() => heldSave.held()).toBe(1);

  await page.getByRole('link', { name: 'Trends' }).click();
  await expect(page).toHaveURL(/\/app\/trends/);
  // Still saving, and already charted: the records table only renders for an exercise with sets.
  await expect(page.getByText('Records · bodyweight')).toBeVisible();

  const stop = await watchForEmpty(page, 'No workouts logged yet');
  const heldHistory = await landTheSaveWithHistoryHeld(page, heldSave);
  await expect(page.getByText('Records · bodyweight')).toBeVisible();

  const historyLanded = page.waitForResponse((r) => HISTORY_SYNC.test(r.url()) && r.ok());
  heldHistory.release();
  await historyLanded;
  await expect(page.getByText('Records · bodyweight')).toBeVisible();

  const { emptySeen, frames } = await stop();
  expect(frames).toBeGreaterThan(0);
  expect(emptySeen, 'Trends showed "No workouts logged yet" while the set was saving').toBe(0);
});
