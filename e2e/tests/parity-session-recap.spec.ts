import { APIRequestContext, Locator, Page, expect, test } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { dismissPrCelebration, endWorkout, logSetAt, pickExercise, tapLogSet } from './support/exercises';
import { delayNetwork, holdNetwork } from './support/faults';
import { expectHistoryMatchesServer } from './support/historyConvergence';
import { pinOfflineViaSettings, unpinOfflineViaSettings, waitForOutboxDrain } from './support/offline';
import { forEachConnectivityMode } from './support/parity';

// Ending a workout names what was actually done -- 2 exercises, 3 sets -- on the card of the "End
// this workout?" sheet, instead of only reporting the state transition. After the End the sheet
// keeps the count it showed (captured at the tap, never recounted), which is what these assert in
// every mode.
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
// Two exercises and three sets on the card.
async function expectTwoExercisesThreeSets(dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('2', { exact: true })).toBeVisible();
  await expect(dialog.getByText('exercises', { exact: true })).toBeVisible();
  await expect(dialog.getByText('3', { exact: true })).toBeVisible();
  await expect(dialog.getByText('sets', { exact: true })).toBeVisible();
}

// The card while asking, the End, the SAME card after it, then a close -- which must work in every
// mode (it also runs the deferred rating ask and forced update, neither of which may depend on the
// network). A one-person household is asked "Who else trains with you?", so the sheet stays open
// after the End; the X closes it without answering.
async function endAndExpectTheCard(page: Page) {
  const asking = page.getByRole('dialog', { name: 'End this workout?' });
  await expectTwoExercisesThreeSets(asking);
  await asking.getByRole('button', { name: 'End workout' }).click();

  const done = page.getByRole('dialog', { name: 'Workout done' });
  await expectTwoExercisesThreeSets(done);
  await done.getByRole('button', { name: 'Close' }).click();
  await expect(done).toBeHidden();
  await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();
}

forEachConnectivityMode<{ personName: string }>('ending a workout reports what was logged', {
  critical: true,
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
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 2')).toBeVisible();

    await page.getByRole('button', { name: '← All exercises' }).click();
    await pickExercise(page, 'Barbell Back Squat');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();

    await page.getByRole('button', { name: 'End workout' }).click();
  },

  // The parity claim itself: the same two numbers in every mode. Duration is deliberately not
  // asserted -- the workout takes however long the test takes, so it is under a minute and the
  // recap correctly omits the clause (see utils/sessionRecap.js).
  assert: async (page) => {
    await endAndExpectTheCard(page);
  },
});

// The sheet's headline -- the one true thing worth saying -- in every mode. This is the claim
// utils/workoutHeadline.js is built around: it must be read at the End tap, while the workout is
// still live in the fold. Degraded, the workout's sets have not synced, so it has no id and exists
// only as the live copy; read after the End, it would be in neither the live fold nor History, and
// the sheet would have nothing to say about it (or say something about the workout before).
forEachConnectivityMode<Record<string, never>>('the end-workout sheet names a new best', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Head');
    // A baseline workout, on the server and in the device's History before the mode is entered.
    await pickExercise(page, 'Barbell Bench Press');
    await logSetAt(page, 100, 5);
    await endWorkout(page);
    await waitForOutboxDrain(page);
    await page.getByLabel('Sections').getByRole('link', { name: 'History' }).click();
    await expect(page.locator('.history-block').getByText('Barbell Bench Press', { exact: true })).toBeVisible();
    await page.getByLabel('Sections').getByRole('link', { name: 'Log' }).click();
    return {};
  },

  navigate: async (page) => {
    await pickExercise(page, 'Barbell Bench Press');
  },

  act: async (page) => {
    await logSetAt(page, 120, 5);
    await page.getByRole('button', { name: 'End workout' }).click();
  },

  assert: async (page) => {
    // Live while asking...
    const asking = page.getByRole('dialog', { name: 'End this workout?' });
    await expect(asking.locator('.brand-card__headline')).toHaveText('A new best on Barbell Bench Press.');
    await asking.getByRole('button', { name: 'End workout' }).click();
    // ...and still there after the End, which is the half that needs the capture at the tap.
    const sheet = page.getByRole('dialog', { name: 'Workout done' });
    await expect(sheet.locator('.brand-card__headline')).toHaveText('A new best on Barbell Bench Press.');
    // The X: a one-person household is asked "Who else trains with you?" in Done's place.
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  },
});

// The sheet's household ask, end to end. Online only, deliberately not a parity spec: adding a
// person is a Tier-3 write (gated, never queued), so offline the button is disabled by the same
// OfflineDisabledWrap as the person bar's -- a divergence the register already covers.
test.describe('The end-workout sheet asks who else trains with you', () => {
  test('adds the second person from the sheet, and stops asking once there is one', async ({ page, request }) => {
    await registerHousehold(page, request, 'Solo');

    await pickExercise(page, 'Barbell Bench Press');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog', { name: 'End this workout?' }).getByRole('button', { name: 'End workout' }).click();

    const sheet = page.getByRole('dialog', { name: 'Workout done' });
    await expect(sheet.getByText('Who else trains with you?', { exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Add a person' }).click();

    // The sheet hands over to the add-person dialog rather than stacking a second one on it.
    await expect(sheet).toBeHidden();
    const addDialog = page.getByRole('dialog', { name: 'Add a person' });
    await addDialog.getByPlaceholder('Name').fill('Partner');
    await addDialog.getByRole('button', { name: 'Add' }).click();
    await expect(addDialog).toBeHidden();

    // Added, and switched to -- the same as adding from the person bar.
    await expect(page.locator('.person-pill-bar').getByRole('button', { name: /Partner/ })).toBeVisible();

    // A second workout: the question has been answered, so the sheet no longer asks it.
    await pickExercise(page, 'Barbell Bench Press');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();
    const asking = page.getByRole('dialog', { name: 'End this workout?' });
    await page.getByRole('button', { name: 'End workout' }).click();
    await asking.getByRole('button', { name: 'End workout' }).click();
    // Nothing left to ask, so the End closes the sheet.
    await expect(asking).toBeHidden();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText('Who else trains with you?', { exact: true })).toHaveCount(0);
  });

  // Someone who trains alone answers once, and is not asked again -- across a reload, because the
  // answer is stored, not held in memory.
  test('"Just me" closes the sheet and stops the question', async ({ page, request }) => {
    await registerHousehold(page, request, 'Alone');
    const sheet = page.getByRole('dialog', { name: 'Workout done' });

    await pickExercise(page, 'Barbell Bench Press');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog', { name: 'End this workout?' }).getByRole('button', { name: 'End workout' }).click();
    await sheet.getByRole('button', { name: 'Just me' }).click();
    await expect(sheet).toBeHidden();

    await page.reload();
    await pickExercise(page, 'Barbell Bench Press');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();
    const asking = page.getByRole('dialog', { name: 'End this workout?' });
    await page.getByRole('button', { name: 'End workout' }).click();
    await asking.getByRole('button', { name: 'End workout' }).click();
    // Nothing left to ask, so the End closes the sheet.
    await expect(asking).toBeHidden();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText('Who else trains with you?', { exact: true })).toHaveCount(0);
  });
});

// The bug report this guards: log some sets, delete them all, end the workout -- the recap must
// report nothing, not the deleted sets. Online only, deliberately not a parity spec: removing an
// already-synced set needs a live `listSessionSets` read (see SessionSummary's entry in
// resilience.md's register), so the "Remove" control is unreachable in the degraded modes at all.
test.describe('Session recap after deleting everything logged', () => {
  test('reports nothing once every logged set has been removed', async ({ page, request }) => {
    await registerHousehold(page, request, 'Del');

    await pickExercise(page, 'Barbell Bench Press');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 2')).toBeVisible();

    await page.getByRole('button', { name: '← All exercises' }).click();
    // Scoped to the session list (SessionSummary's .session-exercises, which exists for exactly
    // this): once the picker's own list refreshes with the exercise just logged, a picker chip of
    // the same name appears below it, so an unscoped getByText matched one element or two
    // depending on which landed first -- this spec's flake, locally and on lower.
    await expect(page.locator('.session-exercises').getByText('Barbell Bench Press', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Nothing logged in this workout yet — pick an exercise below to start.')).toBeVisible();

    await page.getByRole('button', { name: 'End workout' }).click();
    const dialog = page.getByRole('dialog', { name: 'End this workout?' });
    await expect(dialog).toBeVisible();
    // No card: nothing to report.
    await expect(dialog.locator('.brand-card')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'End workout' }).click();
    await expect(page.getByText('Workout ended. Logging a set anytime starts a new one.')).toBeVisible();
    // Nothing to summarise, so no sheet: congratulating an empty workout is worse than the sentence.
    await expect(page.getByRole('dialog', { name: 'Workout done' })).toHaveCount(0);
  });

  // The same flow, pinned to the timing that made the spec above fail on lower -- and each time it
  // did, it was the app, not the spec. Tapping Remove just after logging, on a slow backend, lands
  // in a window where:
  //   - the exercise's LATEST set is still in flight, so the row holds it as an optimistic set; and
  //   - its EARLIER set has synced but `history` has not refetched yet, so the row does not list it
  //     at all (the confirm read "The 1 set" for two logged).
  // Remove then "cancelled" the in-flight create, which cannot un-send a request already on the
  // wire, and skipped enumerating server rows because the row showed none. Nothing was deleted, and
  // both sets came back once history caught up. Both holds below let the requests through for real;
  // they only make the window wide enough to hit every time.
  //
  // Squat is logged first so `history` has an answer to show (not a loading skeleton) while its
  // refetch is held -- the answer lower had, one set behind.
  test('removing an exercise mid-save deletes every set it had, synced or in flight', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Mid');

    await pickExercise(page, 'Barbell Back Squat');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();
    await page.getByRole('button', { name: '← All exercises' }).click();
    const sessionList = page.locator('.session-exercises');
    await expect(sessionList.getByText('Barbell Back Squat', { exact: true })).toBeVisible();

    const heldHistory = await delayNetwork(page, /\/api\/people\/\d+\/history\/sync$/, 3000);
    await pickExercise(page, 'Barbell Bench Press');
    // Only the SECOND bench set is held -- the first must have synced for the row to be missing it.
    const firstBenchSynced = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/people\/\d+\/live-sets$/.test(r.url()) && r.ok(),
    );
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();
    await firstBenchSynced;
    const heldCreate = await delayNetwork(page, /\/api\/people\/\d+\/live-sets$/, 3000);
    const secondBenchLanded = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/people\/\d+\/live-sets$/.test(r.url()),
    );
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 2')).toBeVisible();

    await page.getByRole('button', { name: '← All exercises' }).click();
    await expect(sessionList.getByText('Barbell Bench Press', { exact: true })).toBeVisible();
    // Second row: server entries come first and a pending-only exercise is appended after them
    // (useSessionEntries), and the icon buttons are all named just "Remove".
    await sessionList.getByRole('button', { name: 'Remove' }).nth(1).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(sessionList.getByText('Barbell Bench Press', { exact: true })).toHaveCount(0);

    heldCreate.stop();
    heldHistory.stop();

    // Asked of the SERVER, and only once the held create has landed and every write behind it has
    // drained. Both halves matter: before the create lands, the bug is invisible (the set is not on
    // the server YET), so any earlier read -- including the recap, which converges on history --
    // passes against the unfixed code. It did, until this waited.
    await secondBenchLanded;
    await waitForOutboxDrain(page);
    const logged = await liveWorkoutOnServer(request, email);
    expect(logged).toEqual([{ exercise: 'Barbell Back Squat', sets: 1 }]);

    await expect(sessionList.getByText('Barbell Back Squat', { exact: true })).toBeVisible();
    await expect(sessionList.getByText('Barbell Bench Press', { exact: true })).toHaveCount(0);
  });
});

// What the live workout holds according to the server itself, bypassing every client cache -- the
// only read that can tell "deleted" from "not synced yet". Signs in over the API for its own token.
async function liveWorkoutOnServer(request: APIRequestContext, email: string) {
  const { apiUrl } = await (await request.get('/config.json')).json();
  const login = await request.post(`${apiUrl}/api/auth/login`, { data: { email, password: 'password123' } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json()).token}` };
  const me = await (await request.get(`${apiUrl}/api/auth/me`, { headers })).json();
  const history = await (await request.get(`${apiUrl}/api/people/${me.people[0].id}/history`, { headers })).json();
  const live = history.find((session: { endedAt: string | null }) => session.endedAt === null);
  return (live?.entries ?? []).map((entry: { exerciseName: string; sets: unknown[] }) => ({
    exercise: entry.exerciseName,
    sets: entry.sets.length,
  }));
}

// A "no live workout" answer the app asked for BEFORE a workout's first set must not erase that
// workout. Offline mode is where it bites: the network still works, so a live-session fetch already
// on the wire when the person switched offline mode on (the boot or warm-up fetch, typically) lands
// AFTER their first set -- and its "none" answer used to replace the workout the set had just
// started. The "Session in progress" bar vanished, the next set started a second placeholder from
// its own time, and this recap -- which counts sets logged since the workout started -- dropped
// every set before it ("2 exercises · 2 sets" for three). Seen on lower once, in this file's
// pinned-offline parity test; held deterministically here. Nothing was lost on the server -- the
// convergence check at the end is what says so.
test.describe('Session recap around a late live-session answer', () => {
  test('a "no workout" answer from before the first set does not split the workout', async ({ page, request }) => {
    const liveFetch = await holdNetwork(page, /\/api\/people\/\d+\/sessions\/live$/);
    await registerHousehold(page, request, 'Late');
    await expect.poll(() => liveFetch.held(), { message: 'a live-session fetch to hold' }).toBeGreaterThan(0);

    await pinOfflineViaSettings(page);
    await page.getByRole('link', { name: 'Log' }).click();
    await pickExercise(page, 'Barbell Bench Press');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();

    // The held answer -- "no live workout", true when it was asked -- lands now, after the set.
    const answered = page.waitForResponse(/\/api\/people\/\d+\/sessions\/live$/);
    liveFetch.release();
    await answered;
    await expect(page.getByText(/^Session in progress/)).toBeVisible();

    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 2')).toBeVisible();
    await page.getByRole('button', { name: '← All exercises' }).click();
    await pickExercise(page, 'Barbell Back Squat');
    await tapLogSet(page);
    await dismissPrCelebration(page);
    await expect(page.getByText('Set 1')).toBeVisible();

    await page.getByRole('button', { name: 'End workout' }).click();
    await endAndExpectTheCard(page);

    await unpinOfflineViaSettings(page);
    await waitForOutboxDrain(page);
    await expectHistoryMatchesServer(page, request);
  });
});
