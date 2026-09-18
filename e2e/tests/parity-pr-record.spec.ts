import { expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { logSetAt, pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// Switching the PRs board's record is a pure client-side re-read of an already-warmed query --
// every measure rides on the single `prs` response, the same way the Trends metric switcher rides
// on one trend response. So it must behave identically in every connectivity mode, and there is no
// branch on connectivity anywhere in it.
//
// This is worth a parity spec rather than a comment precisely because it LOOKS like it should need
// the network: the numbers change completely when the dropdown moves, which is the shape of a
// refetch. If somebody ever "optimizes" the measures onto their own request, or gates the picker
// behind useOnlineStatus, this is what fails -- in the three degraded modes only, naming the mode.
//
// `prs` is in offlineCacheWarm's bundle with refreshAfterRestore, so the cache is genuinely warm
// in every mode here; that is what makes the claim true rather than lucky.

const EXERCISE = 'Barbell Bench Press';

// ⚠️ `getByLabel('Record')` must always carry `exact: true`. Playwright matches an accessible name
// as a case-insensitive SUBSTRING, and the app is full of "…, personal record" — the PR badge on
// every History row and every Log set row. Without it this resolves to those badges instead of the
// picker: a strict-mode violation when several are on screen, and "Element is not a <select>" when
// one is, the latter arriving mid-navigation from whichever screen has not unmounted yet.

forEachConnectivityMode<void>('the PRs record picker re-measures the board from the warmed cache', {
  async setup(page, request) {
    await registerHousehold(page, request, 'Rowan');

    // 225x1 is the top weight; 185x8 is the better estimated 1RM. The two measures DISAGREE, which
    // is what makes the assertion below able to tell them apart at all.
    await pickExercise(page, EXERCISE);
    await logSetAt(page, 225, 1);
    await logSetAt(page, 185, 8);

    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page).toHaveURL(/\/app\/prs/);

    // Wait for the network to go quiet BEFORE asserting, not after. offlineCacheWarm prefetches
    // this same `prs` key at boot -- i.e. before any of these sets existed -- and that warm
    // request resolves with an EMPTY list that lands on top of the fresh one. Asserting first and
    // waiting second measures the race instead of settling it: the row is visible for a moment,
    // the empty warm overwrites the cache, and the degraded modes then read a board warmed empty
    // and show "No PRs yet". Same race offline-reads.spec.ts pays for, one ordering stricter.
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('pr-row')).toHaveCount(1);
    // The picker only renders once the board has rows, so this is also the gate that proves the
    // cache is genuinely warm before a mode cuts the network.
    await expect(page.getByLabel('Record', { exact: true })).toBeVisible();
  },

  async navigate(page) {
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page).toHaveURL(/\/app\/prs/);
  },

  async act(page) {
    await page.getByLabel('Record', { exact: true }).selectOption('heaviest');
  },

  // Mode-independent, deliberately: this IS the parity claim. No `ctx.degraded` branch.
  async assert(page) {
    const row = page.getByTestId('pr-row').first();
    // Top weight is the 225 single...
    await expect(row).toContainText('225 lb');
    // ...and its qualifier is the reps at that weight, not the est. 1RM's set.
    await expect(row).toContainText('× 1');

    // Switching back restores the est. 1RM view, which is a different number from a different set.
    await page.getByLabel('Record', { exact: true }).selectOption('est1rm');
    await expect(row).toContainText('234.3 lb');
    await expect(row).toContainText('185lb×8');
  },
});
