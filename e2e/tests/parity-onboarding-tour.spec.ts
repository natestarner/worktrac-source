import { expect } from '@playwright/test';
import { forEachConnectivityMode } from './support/parity';
import { registerHousehold } from './support/auth';

// The one place the tour's own logic reads data that could vary by connectivity mode: steps 5-7
// need an exercise to open, and pickTourExercise (tourExercise.js) resolves that from the
// exercises/personExercises caches. Everything else about the tour is pure client-side navigation
// and dispatch -- this is the single claim worth a parity test.
//
// No branch on ctx.mode: this fails immediately the moment anyone makes the tour gate on
// useOnlineStatus or await a fetch, which is exactly the regression
// .claude/rules/resilience.md's "reuse the mechanism" table (and ProductTour.jsx's own header
// comment) exist to prevent.
//
// NOT a test of the cold-offline-empty-catalog case: `setup` runs ONLINE (registerHousehold warms
// `exercises` + `personExercises` just by landing on /app/log), so the catalog is always warm
// here. That case -- an empty catalog resolving to null, and the tour degrading honestly with no
// spotlight rather than crashing -- is pinned by tourExercise.test.js and ProductTour.test.jsx's
// missing-anchor test instead. Deliberately kept to ONE assertion at ONE step rather than all nine
// steps across all four modes, per the standing rule against multiplying a suite whose known
// failure mode is a load-dependent Vite death.
forEachConnectivityMode('the tour opens a real exercise for step 5', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Zephyr');
    return {};
  },
  navigate: async (page) => {
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Help' }).click();
    await expect(page).toHaveURL(/\/app\/help/);
  },
  act: async (page) => {
    await page.getByRole('button', { name: 'Take the tour' }).click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }
  },
  assert: async (page) => {
    await expect(page.getByText('Step 5 of 9')).toBeVisible();
    await expect(page.getByText('Weight and reps', { exact: true })).toBeVisible();
    await expect(page.locator('[data-tour-anchor="log-set"]')).toBeVisible();

    // The tour's own full-viewport click-blocking layer (deliberate -- see ProductTour.jsx) would
    // otherwise intercept the pinned-offline mode's "Go back online" click that
    // forEachConnectivityMode's restore step performs next. Closing it here is test cleanup, not
    // part of the parity claim itself.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  },
});
