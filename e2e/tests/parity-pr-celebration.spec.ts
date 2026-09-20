import { expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise, setStepperPair } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// ⚠️ THIS IS THE SPEC THE WHOLE CLIENT-SIDE-DETECTION CHANGE EXISTS FOR.
//
// The PR celebration used to be raised from the log-set response's `isPR`, which meant it fired in
// exactly ONE of the four modes below:
//
//   online          the response arrives -> celebration                          PASSED
//   lie-fi          the mutation settles with data === undefined                 never fired
//   hard-offline    the mutation never settles at all                            never fired
//   pinned-offline  same                                                         never fired
//
// and after a reload mid-outage it never fired even once the write landed, because a replay from
// the durable outbox has no component observer to run `onSuccess`. A record set in a gym basement
// -- the app's actual use case -- was silently never celebrated, and no spec covered it.
//
// Detection now runs at DISPATCH from bests the client already holds (utils/prDetection.js), so
// there is one code path and no connectivity branch. This spec is what keeps that true.
//
// TO VERIFY IT IS NOT VACUOUS: move the showCelebration call in ExerciseDetail#handleLogSet back
// into logSetMutation.onSuccess. The three degraded modes must fail. A parity spec that passes
// either way guards nothing (resilience.md).
//
// Note `assert` never branches on ctx.mode -- that is the rule, and it is also the claim: the
// person sees the same thing whatever the network is doing.
forEachConnectivityMode<{ personName: string }>('a PR is celebrated the moment it is logged', {
  setup: async (page, request) => {
    const personName = 'Celeb';
    await registerHousehold(page, request, personName);
    // Establish a beatable baseline ONLINE, so the set logged inside the mode is a genuine record
    // rather than a first-ever set (which is deliberately presented as a baseline, not a PR).
    await pickExercise(page, 'Barbell Bench Press');
    await setStepperPair(page, 135, 5);
    await page.getByRole('button', { name: 'Log set' }).click();
    const first = page.getByText('New PR!');
    await expect(first).toBeVisible();
    await first.click({ force: true });
    await expect(first).toBeHidden();
    // Back to the picker, then straight back in. Logging a set leaves the exercise screen open and
    // `navigate` below searches the picker, so the trip out is needed either way -- but the trip
    // BACK IN is what makes this deterministic: it refetches exerciseSummary and history ONLINE
    // with the baseline in them.
    //
    // Without it the mode is entered with caches that may predate the baseline set (the write's
    // invalidation races the mode switch), the prior best reads as absent, and the set logged
    // in-mode is treated as a first-ever one. That is the app degrading honestly; it just is not
    // what this spec means to measure. The control is "<- All exercises", not "Back" -- the App
    // Settings screen is the one with a "Back".
    await page.getByRole('button', { name: /All exercises/ }).click();
    await pickExercise(page, 'Barbell Bench Press');
    // The Best card, which is what proves exerciseSummary actually landed with the baseline in it.
    // Not the "Last time" card: this workout is still live, so getLastSession excludes it and
    // there is no previous session to show. 135 x (1 + 5/30) = 157.5.
    await expect(page.getByText(/\(135lb×5\)/)).toBeVisible();
    await page.getByRole('button', { name: /All exercises/ }).click();
    return { personName };
  },

  navigate: async (page) => {
    await pickExercise(page, 'Barbell Bench Press');
  },

  act: async (page) => {
    // Heavier AND more reps, so this takes both set-level records at once.
    await setStepperPair(page, 185, 8);
    await page.getByRole('button', { name: 'Log set' }).click();
  },

  assert: async (page) => {
    const celebration = page.getByText('New PR!');
    await expect(celebration).toBeVisible();

    // Both records, in ONE overlay -- not a queue of them. Three queued overlays at the old 2800ms
    // each would have blocked the screen for eight seconds between sets.
    //
    // Asserted by the badge LABELS, not just the numbers: two bare figures stacked with only an
    // icon between them do not say which record is which, and naming them is the whole point of
    // differentiating the types.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Top weight');
    await expect(dialog).toContainText('Est. 1RM');
    await expect(dialog).toContainText('185 lb'); // the top weight
    await expect(dialog).toContainText('234.3 lb'); // 185 x (1 + 8/30), under the 12-rep cap

    // It PERSISTS. The old 2800ms auto-dismiss meant a record set mid-conversation was missed, so
    // the overlay now waits for a person. Three seconds is comfortably past the old timer.
    await page.waitForTimeout(3200);
    await expect(celebration).toBeVisible();

    // And every exit works. The button first, since it is the one a thumb finds.
    await page.getByRole('button', { name: 'Nice' }).click();
    await expect(celebration).toBeHidden();
  },

  afterReconnect: async (page) => {
    // The set really did land, and the board agrees with what was celebrated. This is the half
    // `assert` cannot see while degraded: a celebration that fired over a write that never synced
    // would be a lie, and this is what rules that out.
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByTestId('pr-row').filter({ hasText: 'Barbell Bench Press' })).toBeVisible();
  },
});

// The session-volume record is the one celebrated measure that is not a property of the set just
// logged, so it gets its own coverage: it must fire ONCE, on the set that carries the running total
// past the old record, and stay quiet for the rest of the workout.
//
// ⚠️ This is the behaviour that could not have been built with a "have I celebrated this session?"
// flag: the only natural key for one is the session id, and contextSessionId is null for a person's
// entire offline stretch -- so the guard would be dead in three of the four modes this runs in.
// The crossing test is stateless, which is why it survives them.
forEachConnectivityMode<{ personName: string }>('a session-volume record fires once, not once per set', {
  setup: async (page, request) => {
    const personName = 'Vol';
    await registerHousehold(page, request, personName);
    // A one-set baseline workout: 100 x 10 = 1000 lb of volume to beat.
    await pickExercise(page, 'Barbell Bench Press');
    await setStepperPair(page, 100, 10);
    await page.getByRole('button', { name: 'Log set' }).click();
    const first = page.getByText('New PR!');
    await expect(first).toBeVisible();
    await first.click({ force: true });
    await expect(first).toBeHidden();
    // End it, so the next workout is a new session and its volume starts from zero. The confirm
    // is scoped to the dialog -- the SessionBar's own button carries the same name.
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();
    await expect(page.getByRole('button', { name: 'End workout' })).toHaveCount(0);
    // Back to the picker and in again, so exerciseSummary and history are refetched ONLINE with
    // the baseline workout in them -- see the note in the spec above for why that matters.
    const back = page.getByRole('button', { name: /All exercises/ });
    if (await back.isVisible()) await back.click();
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByText('100lb×10', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /All exercises/ }).click();
    return { personName };
  },

  navigate: async (page) => {
    await pickExercise(page, 'Barbell Bench Press');
  },

  act: async (page) => {
    // Three light sets of 60 lb x 10 = 600 each. Running total 600, 1200, 1800 against a record of
    // 1000, so the SECOND set is the crossing and the third must stay quiet.
    //
    // 60 x 10 also keeps every set below the est. 1RM and top-weight records set at 100 x 10, so
    // the only thing that can fire here is volume -- otherwise this would pass on the wrong record.
    let fired = 0;
    for (let i = 0; i < 3; i++) {
      await setStepperPair(page, 60, 10);
      await page.getByRole('button', { name: 'Log set' }).click();
      const celebration = page.getByText('New PR!');
      if (await celebration.isVisible()) {
        // Whatever fires here must be the VOLUME record. Every set is 60x10, below the 100x10
        // baseline on both weight and estimate, so a "Top weight" or "Est. 1RM" badge would mean
        // the prior bests were not actually loaded and this spec is measuring nothing.
        await expect(page.getByRole('dialog')).toContainText('Volume');
        fired += 1;
        await celebration.click({ force: true });
        await expect(celebration).toBeHidden();
      }
      await expect(page.getByText(/^Set \d+$/)).toHaveCount(i + 1);
    }
    // EXACTLY ONCE. Zero would mean the crossing never fired; two or three would mean the record
    // is chasing itself, which is what including the current session in the prior best causes.
    expect(fired).toBe(1);
  },

  assert: async (page) => {
    // All three sets landed, and no celebration is left on screen -- if the third set had re-fired
    // (the record chasing itself, which is what including the current session in the prior best
    // would cause) the overlay would still be up here.
    await expect(page.getByText(/^Set \d+$/)).toHaveCount(3);
    await expect(page.getByText('New PR!')).toBeHidden();
  },
});
