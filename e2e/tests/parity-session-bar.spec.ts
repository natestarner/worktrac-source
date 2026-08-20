import { expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// The session bar is the app's bottom chrome: it carries "Session in progress", the start time, the
// rest readout, and the only "End workout" control. It replaced an in-flow banner at the top of the
// Log tab and a floating rest-timer pill.
//
// It has to appear the moment a set is logged in EVERY connectivity mode, because it is driven off
// the same `liveSession` cache entry the old banner was -- including the PROVISIONAL
// `{ id: null, startedAt: <clientLoggedAt> }` that logSetMutation.onMutate seeds while nothing has
// reached the server. Nothing here branches on connectivity, and the assertion below must never
// grow such a branch: `contextSessionId` stays null for a person's whole outage, so a bar that
// waited on a real session id would simply be absent for the entire time, and with it the only way
// to end the workout.
//
// The rest timer half is client-side wall-clock with no network dependency at all -- which is
// exactly why it is asserted here rather than argued in a comment.
forEachConnectivityMode<{ personName: string }>('session bar appears with the rest timer when a set is logged', {
  setup: async (page, request) => {
    const personName = 'Bar';
    await registerHousehold(page, request, personName);
    return { personName };
  },

  navigate: async (page) => {
    await pickExercise(page, 'Barbell Bench Press');
  },

  act: async (page) => {
    await page.getByRole('button', { name: 'Log set' }).click();
  },

  assert: async (page) => {
    // The bar, with an honest start time -- offline that comes from clientLoggedAt, not from a
    // server round trip that has not happened.
    await expect(page.getByText(/Session in progress · started/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'End workout' })).toBeVisible();

    // The rest readout, counting up. Bare digits by design (a visible "Rest" would substring-collide
    // with Settings' "Rest timer" toggle), so it is selected by its role="img" accessible name.
    await expect(page.getByRole('img', { name: /^Rest [0-9]/ })).toBeVisible();

    // And the ring on this person's own pill, which is the household-visible half of the same
    // timer. Both are role="img" badges folded into their container's accessible name.
    await expect(
      page.locator('.person-pill-bar').getByRole('button', { name: /Bar/ }).getByRole('img', { name: /^Resting$/ }),
    ).toBeVisible();
  },

  afterReconnect: async (page) => {
    // Once the create-session round trip lands, the same bar is now backed by a REAL session id.
    // The user-visible result must be indistinguishable from the provisional one it replaced --
    // this is the half `assert` cannot see while degraded.
    await expect(page.getByText(/Session in progress · started/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'End workout' })).toBeVisible();
  },
});
