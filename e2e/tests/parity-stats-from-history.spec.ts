import { expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { logSetAt, pickExercise } from './support/exercises';
import { waitForOutboxDrain } from './support/offline';
import { forEachConnectivityMode } from './support/parity';

// The PRs board and Trends are built on the device from History (hooks/useStatsFromHistory.js),
// with the workout in progress folded in -- its queued sets included. So a record set logged in ANY
// mode is on the board and in the Trends records table at once, by one code path, and Trends works
// with no connection at all. docs/architecture/prs-trends-from-history.md.
//
// Before this, both were server answers: offline, a record set logged in the basement was absent
// from the board until the outbox drained and /prs was refetched, and Trends said "Trends need a
// connection" on a device that had never opened it online.

const EXERCISE = 'Barbell Bench Press';

forEachConnectivityMode<void>('a record logged in any mode is on the PRs board and in Trends at once', {
  async setup(page, request) {
    await registerHousehold(page, request, 'Harper');
    await pickExercise(page, EXERCISE);
    // A baseline the record will beat: 135x5 estimates 157.5 lb.
    await logSetAt(page, 135, 5);
    await waitForOutboxDrain(page);
    // The baseline is in History (the board's source) before any mode cuts the network.
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page).toHaveURL(/\/app\/prs/);
    await expect(page.getByTestId('pr-row').first()).toContainText('157.5 lb');
    await page.waitForLoadState('networkidle');
  },

  // The Log tab remembers the exercise setup opened, so it is usually already on screen; pick it
  // only if the tab came back to the picker instead.
  async navigate(page) {
    const picker = page.getByPlaceholder('Search all exercises');
    await expect(picker.or(page.getByRole('button', { name: 'Log set' })).first()).toBeVisible();
    if (await picker.isVisible()) await pickExercise(page, EXERCISE);
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
  },

  async act(page) {
    // 185x5 estimates 215.8 lb: a new record, in whatever mode this is.
    await logSetAt(page, 185, 5);
  },

  // Mode-independent, deliberately: this IS the parity claim. No `ctx.degraded` branch.
  async assert(page) {
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page).toHaveURL(/\/app\/prs/);
    const row = page.getByTestId('pr-row').first();
    await expect(row).toContainText('215.8 lb');
    await expect(row).toContainText('185lb×5');

    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page).toHaveURL(/\/app\/trends/);
    await expect(page.getByText('Trends need a connection')).toBeHidden();
    await expect(page.getByText(/215\.8 lb \(185 lb × 5\)/)).toBeVisible();
  },

  // Synced now: the same record, read from History rather than from the queue.
  async afterReconnect(page) {
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page).toHaveURL(/\/app\/prs/);
    await expect(page.getByTestId('pr-row').first()).toContainText('215.8 lb');
    await expect(page.getByTestId('pr-row')).toHaveCount(1);
  },
});
