import { expect, type Page } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { backToPicker, logSetAt, pickExercise, setStepperPair } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// ⚠️ THIS IS THE SPEC THAT KEEPS THE LOG SCREEN AND HISTORY TELLING THE SAME STORY.
//
// Three things used to be true at once, and all three were visible to one person in one workout:
//
//   1. The Log screen marked a record with a green "PR" token; History used the warm palette.
//   2. The Log screen asked a DIFFERENT question -- formulas.js#isPrSet, a +-0.5 TIE with the
//      all-time best -- so hitting your best three times pilled three rows here and badged one
//      there. It also only knew about est. 1RM, so a top-weight record went unmarked on Log.
//   3. "Session exercises" showed no record marks at all, for any record, ever.
//
// Every record mark now comes from historyPrFlags.js#buildHistoryPrFlags, with the live session
// folded in. Because those live entries come from caches that already merge still-queued writes,
// the mark appears with no signal, by one code path -- which is what this spec runs across modes
// to prove. It is NOT a connectivity branch and reads useOnlineStatus nowhere.
//
// VERIFIED NON-VACUOUS, and each spec is guarded by its OWN caller -- they do not cover for each
// other, so check the right one:
//
//   drop `liveSession` from ExerciseDetail's buildHistoryPrFlags call  -> spec 1 fails lie-fi,
//     hard-offline and pinned-offline; online still passes
//   drop `liveSession` from LogTab's                                   -> spec 2 fails the same
//     three, online still passes
//
// Online passing either way is the point: once the write lands, `history` refetches and carries
// the set itself. Only the degraded modes depend on the live fold -- which is exactly the shape
// the old response-driven celebration had, and exactly what this spec exists to stop coming back.
//
// ⚠️ WHAT THIS SPEC DOES **NOT** COVER: the null-session-id path. `setup` logs a set online, so a
// real session id already exists by the time the mode is entered and `contextSessionId` is never
// null here -- making the fold ignore an id-less live session changes nothing in any of these
// eight runs. That branch (LIVE_SESSION_FLAG_KEY, which carries a person's entire offline stretch
// before a session materializes) is covered in historyPrFlags.test.js's "the live session" block.
// Don't read a green run here as evidence about it.
//
// Note `assert` never branches on ctx.mode. That is the rule, and it is also the claim.

// logSetAt insists on a celebration, because every other caller logs strictly increasing bests.
// This one deliberately logs a set that takes NOTHING, which is what makes the counts below
// meaningful rather than "everything is badged".
async function logSetTakingNoRecord(page: Page, weight: number, reps: number) {
  const setRows = page.getByText(/^Set \d+$/);
  const rowsBefore = await setRows.count();
  await setStepperPair(page, weight, reps);
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(setRows).toHaveCount(rowsBefore + 1);
  // If this ever DID raise a celebration the set was not the no-record set this helper promises,
  // and every count below would be measuring something else.
  await expect(page.getByText('New PR!')).toBeHidden();
}

forEachConnectivityMode<{ personName: string }>('records are badged on the sets that took them, in the session in progress', {
  setup: async (page, request) => {
    const personName = 'Badge';
    await registerHousehold(page, request, personName);
    // A beatable baseline, logged ONLINE. Note this first-ever set takes both set-level records
    // itself -- that is correct and is why the expected count below is two, not one.
    await pickExercise(page, 'Barbell Bench Press');
    await logSetAt(page, 135, 5);
    // Out and back in, so the mode is entered with exerciseSummary and history holding the
    // baseline -- see parity-pr-celebration.spec.ts's note on why this is load-bearing.
    await backToPicker(page);
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByText(/\(135lb×5\)/)).toBeVisible();
    await backToPicker(page);
    return { personName };
  },

  navigate: async (page) => {
    await pickExercise(page, 'Barbell Bench Press');
  },

  act: async (page) => {
    // Heavier AND more reps, so this takes both set-level records at once.
    await logSetAt(page, 185, 8);
    // And one that takes nothing, so "exactly two are badged" is a real claim.
    await logSetTakingNoRecord(page, 95, 5);
  },

  assert: async (page) => {
    const rows = page.locator('.log-sets-col');
    await expect(rows.getByText(/^Set \d+$/)).toHaveCount(3);

    // Two of the three took records, and the marker NAMES which ones -- the same accessible name
    // History's set pills carry. The old green token said only "Personal record", never which, and
    // knew about est. 1RM alone, so the top-weight half went unmarked here while History marked it.
    await expect(rows.getByTitle('Personal record: top weight, est. 1rm')).toHaveCount(2);
    // ...and no other record wording is on any row, so the third is genuinely unmarked.
    await expect(rows.getByTitle(/^Personal record/)).toHaveCount(2);
  },

  afterReconnect: async (page) => {
    // The half `assert` cannot see while degraded: History, reading the synced session, marks the
    // same sets the same way. A badge on the Log screen that History later disagreed with would be
    // the exact divergence this change removes.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByTitle('Personal record: top weight, est. 1rm').first()).toBeVisible();
  },
});

// "Session exercises" is the other half of the Log tab, and it showed nothing at all. Its rows are
// entry rows -- the same shape as History's -- so they take the same treatment: set-level records
// on the set pill, and the session total beside the exercise NAME, because no single set is the
// answer to "most volume".
forEachConnectivityMode<{ personName: string }>('the session-exercises list badges records like History does', {
  setup: async (page, request) => {
    const personName = 'SessBadge';
    await registerHousehold(page, request, personName);
    await pickExercise(page, 'Barbell Bench Press');
    await logSetAt(page, 100, 10);
    await backToPicker(page);
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByText(/\(100lb×10\)/)).toBeVisible();
    await backToPicker(page);
    return { personName };
  },

  navigate: async (page) => {
    await pickExercise(page, 'Barbell Bench Press');
  },

  act: async (page) => {
    await logSetAt(page, 155, 8);
    // The list renders on the picker, not on the exercise screen.
    await backToPicker(page);
  },

  assert: async (page) => {
    const list = page.locator('.session-exercises');
    await expect(list).toBeVisible();

    // Set-level records on the pills. Both sets took both records (the first was a first-ever
    // set, the second beat it), so both pills carry the marker.
    await expect(list.getByTitle('Personal record: top weight, est. 1rm')).toHaveCount(2);

    // The session total, beside the exercise NAME rather than on any one set. This is the badge
    // History puts on its entry header, and the only one of the three that is not a set property.
    await expect(list.getByLabel('personal record: volume for Barbell Bench Press')).toBeVisible();
  },
});
