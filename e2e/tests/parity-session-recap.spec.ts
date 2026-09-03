import { expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// Ending a workout now names what was actually done -- "2 exercises · 3 sets" -- in the confirm
// modal and again in the toast, instead of only reporting the state transition.
//
// This is asserted across every connectivity mode rather than online alone, because the obvious
// implementation is wrong everywhere except online. A live session's id stays `null` for a person's
// entire offline/lie-fi stretch (see log-screen.md's three pending-value fallbacks), so the
// server-side `history` entry the recap would naturally be read from does not exist and never will
// until the outbox drains. A recap sourced from `history` alone therefore reports "0 sets" for a
// workout someone has just finished -- and it would do so in exactly the conditions this app is
// built for, a basement gym with no signal.
//
// What makes it correct is `useSessionEntries`, the same merge LogTab's "Session exercises" list
// uses: server entries plus the pending log-set mutations, which are the ONLY record of those sets
// while degraded. No branch on connectivity is involved, which is why this adds no row to
// resilience.md's register -- and why the assertion below must never grow one either.
forEachConnectivityMode<{ personName: string }>('ending a workout reports what was logged', {
  setup: async (page, request) => {
    const personName = 'Rec';
    await registerHousehold(page, request, personName);
    return { personName };
  },

  navigate: async (page) => {
    await pickExercise(page, 'Barbell Bench Press');
  },

  // Two sets on one exercise, then a second exercise -- so the counts are distinguishable from each
  // other and from the number of taps. A recap that accidentally counted sets as exercises, or
  // dropped the pending rows, cannot pass this.
  act: async (page) => {
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1')).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 2')).toBeVisible();

    await page.getByRole('button', { name: '← All exercises' }).click();
    await pickExercise(page, 'Barbell Back Squat');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1')).toBeVisible();

    await page.getByRole('button', { name: 'End workout' }).click();
  },

  // The parity claim itself: the same two numbers in every mode. Duration is deliberately not
  // asserted -- the workout takes however long the test takes, so it is under a minute and the
  // recap correctly omits the clause (see utils/sessionRecap.js).
  assert: async (page) => {
    await expect(page.getByRole('dialog', { name: 'End this workout?' })).toBeVisible();
    await expect(page.getByText('2 exercises · 3 sets')).toBeVisible();

    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();

    await expect(page.getByText('Workout ended — 2 exercises · 3 sets.')).toBeVisible();
  },
});
