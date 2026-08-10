import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { goHardOffline, goOnline, offlineSavedLocallyBanner, waitForOutboxDrain } from './support/offline';
import { failNetwork } from './support/faults';

function personPill(page, name: string) {
  return page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) });
}

// Steps the weight to an exact value. Deliberately convergent rather than "click + twice":
// ExerciseDetail's computePrefillDraft effect re-seeds the draft when the summary/session-sets
// queries settle, which can land AFTER a fixed burst of clicks and silently stomp them. Re-reading
// the displayed value each pass makes this immune to that race. '−' is U+2212 (&minus;), not a
// hyphen, and the stepper's +/- carry no accessible name of their own, so scope by the row label.
async function setWeight(page, target: number) {
  const row = page.locator('.stepper-row').filter({ hasText: 'Weight' });
  const value = row.locator('.stepper-value');
  await expect
    .poll(
      async () => {
        const current = Number(await value.textContent());
        if (current === target) return current;
        await row.getByRole('button', { name: current < target ? '+' : '−', exact: true }).click();
        return Number(await value.textContent());
      },
      { timeout: 15000 },
    )
    .toBe(target);
}

// Everything below is scoped to the "This session" column and addressed relatively, never by
// looking a row up from its weight text: the same "45 lb × 8" can legitimately appear on more
// than one row, which is a strict-mode violation waiting to happen.
function sessionList(page) {
  return page.locator('.log-sets-col');
}

// One per rendered set row -- the count is the stable way to wait for a newly logged set.
function setRowLabels(page) {
  return sessionList(page).getByText(/^Set \d+$/);
}

function prBadges(page) {
  return sessionList(page).getByTitle('Personal record');
}

// The flex container holding "Set N", the weight×reps text, and the PR pill -- reached from the
// badge outward, so "which row is badged" is read off the badge itself.
function badgeRow(page) {
  return prBadges(page).locator('..');
}

// Mode 3 reads: search, History, and switching the active person all read from the warmed
// query cache offline (see offlineCacheWarm.js / useOfflineCacheWarming.js) -- distinct from
// offline-cache-warming.spec.ts's focus on a person who was never visited before going offline.
test.describe('Offline mode — reads over the warmed cache', () => {
  test('searching the exercise catalog works offline', async ({ page, request }) => {
    const catalogLoaded = page.waitForResponse((response) => /\/api\/exercises$/.test(response.url()));
    await registerHousehold(page, request, 'Harper');
    // Wait for the catalog's own initial fetch to land before cutting the connection -- it's
    // what backs the search below, and going offline before it resolves would race it.
    await catalogLoaded;

    await goHardOffline(page);
    await expect(offlineSavedLocallyBanner(page)).toBeVisible();

    await page.getByPlaceholder('Search all exercises').fill('Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Barbell Bench Press', exact: true })).toBeVisible();
  });

  test('History with real logged data resolves offline', async ({ page, request }) => {
    await registerHousehold(page, request, 'Indigo');
    await pickExercise(page, 'Barbell Bench Press');
    // Set explicitly rather than riding the prefill: a brand-new exercise has no prefill at all
    // now (computePrefillDraft returns null and a blank logs as 0), and 0 is a BODYWEIGHT set to
    // this app -- comparableLb switches to comparing reps, which would quietly change what the
    // assertions below are measuring.
    await setWeight(page, 45);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    await goHardOffline(page);
    // Navigate away and back (client-side, no full reload -- reload-while-offline needs the
    // production service worker, see offline-mode.spec.ts) to force History's query to remount
    // and prove it resolves from the warmed cache with no network.
    await page.getByRole('link', { name: 'PRs' }).click();
    await page.getByRole('link', { name: 'History' }).click();

    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
    await expect(page.getByText('45lb×8')).toBeVisible();
  });

  test('switching the active person offline serves each one their own warmed data with no leak', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jules');
    await pickExercise(page, 'Barbell Bench Press');
    await setWeight(page, 45);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(1);

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Kit');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await goHardOffline(page);
    await expect(offlineSavedLocallyBanner(page)).toBeVisible();

    // Kit (just added, active now) has never logged anything -- their own empty History, not
    // Jules's set.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('No workouts logged yet for Kit.')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toBeHidden();

    // Switching back to Jules offline still shows Jules's own real history.
    await personPill(page, 'Jules').click();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
    await expect(page.getByText('No workouts logged yet for Jules.')).toBeHidden();
  });
});

// PRs is now part of the warmed bundle (offlineCacheWarm.js), not purely interaction-scoped, so
// it must survive a connectivity drop the same way History already does above -- both hard
// offline and "lie-fi" (online per navigator.onLine, but the request itself fails).
test.describe('Offline mode — PRs reads over the warmed cache', () => {
  test('PRs with a real logged set resolves hard offline', async ({ page, request }) => {
    await registerHousehold(page, request, 'Marlowe');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)

    await page.getByRole('link', { name: 'PRs' }).click();
    // toHaveURL as well as the name: "Barbell Bench Press" is ALSO the Log screen's own title, so
    // the name alone passes while this click is still in flight.
    await expect(page).toHaveURL(/\/app\/prs/);
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
    // ...and then wait for the network to go quiet before cutting it. The boot-time cache warm
    // (offlineCacheWarm.js) prefetches this same `prs` key; a warm request issued before the set
    // existed can still be in flight here, and writes its EMPTY result over the row we just
    // asserted. Offline there is then nothing left to refetch and the board reads "No PRs yet".
    // That race is the app's documented warm-vs-fresh behaviour, not this screen misbehaving --
    // it just needs the test to stop measuring it.
    await page.waitForLoadState('networkidle');

    await goHardOffline(page);
    // Navigate away and back (client-side, no full reload) to force the PRs query to remount
    // and prove it resolves from the warmed cache with no network.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/app\/history/);
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page).toHaveURL(/\/app\/prs/);

    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
    await goOnline(page);
  });

  test('PRs with a real logged set resolves during lie-fi (fetch attempted but fails)', async ({ page, request }) => {
    await registerHousehold(page, request, 'Adair');
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true });

    await page.getByRole('link', { name: 'PRs' }).click();
    // toHaveURL + networkidle for the same two reasons as the hard-offline test above.
    await expect(page).toHaveURL(/\/app\/prs/);
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Stays online per navigator.onLine, but the request itself fails -- TanStack keeps the
    // last-good warmed data on screen instead of clearing it just because a background
    // refetch (triggered by this remount) fails.
    await failNetwork(page, /\/api\/people\/\d+\/prs$/);
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/app\/history/);
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page).toHaveURL(/\/app\/prs/);

    await expect(page.getByText('Barbell Bench Press')).toBeVisible();
  });
});

// Exercise Detail's "Last time"/"Best est. 1RM" card is interaction-scoped
// (queryKeys.exerciseSummary is keyed on personId + exerciseId + contextSessionId), so it's
// realistic to open a given (exercise, no-live-session) combination for the first time while
// the live query can't get an answer -- either genuinely offline, or online-but-unreachable
// ("lie-fi"). Both must resolve from the already-warmed history cache
// (exerciseSummaryFromHistory.js) instead of hanging or falsely showing "No sets yet"/"No PR yet".
test.describe('Offline mode — Exercise Detail summary derived from warmed history', () => {
  async function logSetAndEndWorkout(page, personName) {
    await pickExercise(page, 'Barbell Bench Press');
    // Explicit, not the prefill -- see the note on the 'Indigo' test above.
    await setWeight(page, 45);
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();
    // Ending a workout from the exercise screen returns you to the Log picker automatically.
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();
    // Confirm liveSession has genuinely settled to "none" (the person-pill's live-session dot
    // clears -- same signal reload-persistence.spec.ts uses) before a caller cuts the
    // connection. The picker rendering doesn't itself prove this: a not-yet-corrected "still
    // live" snapshot would freeze that way forever offline (a paused query can never revalidate
    // it away), wrongly excluding this very session from "Last time" on the next visit.
    await expect(personPill(page, personName).locator('span')).toHaveCount(1);
  }

  test('derives Last time/Best est. 1RM hard offline for an (exercise, no-live-session) key never fetched before', async ({
    page,
    request,
  }) => {
    await registerHousehold(page, request, 'Ellery');
    await logSetAndEndWorkout(page, 'Ellery');

    await goHardOffline(page);
    await expect(offlineSavedLocallyBanner(page)).toBeVisible();

    // The only prior visit to this exercise's detail screen was mid-session (a live-session-keyed
    // cache entry) -- opening it again now (no live session) queries a genuinely new cache key.
    await pickExercise(page, 'Barbell Bench Press');

    // exact: true -- "45lb×8" is also a substring of the Best card's "57 lb  (45lb×8)".
    await expect(page.getByText('45lb×8', { exact: true })).toBeVisible(); // "Last time"
    await expect(page.getByText(/57 lb/)).toBeVisible(); // "Best · Est. 1RM"
    await goOnline(page);
  });

  test('derives Last time/Best est. 1RM during lie-fi for the same never-fetched key', async ({ page, request }) => {
    await registerHousehold(page, request, 'Frankie');
    await logSetAndEndWorkout(page, 'Frankie');

    // Stays online per navigator.onLine, but the summary fetch itself fails -- simulating an
    // unreachable backend. This is the exact cache key that's never been fetched before.
    await failNetwork(page, /\/api\/people\/\d+\/exercises\/\d+\/summary/);
    await pickExercise(page, 'Barbell Bench Press');

    // The real query client retries twice with backoff (~3s) before settling into isError --
    // give this room past the default 5s timeout rather than racing that backoff window.
    // exact: true -- "45lb×8" is also a substring of the Best card's "57 lb  (45lb×8)".
    await expect(page.getByText('45lb×8', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/57 lb/)).toBeVisible();
  });

  // `history` is only ever INVALIDATED after a write, never optimistically written, and
  // invalidation is a no-op while paused -- so a best derived from it alone freezes for the whole
  // offline stretch while the set rows keep coming. Since the pill asks "does this TIE the
  // all-time best", that stale best doesn't merely drop the badge, it moves it onto a later,
  // lighter set that happens to tie the pre-offline best. Covered as a unit in
  // frontend/src/utils/exerciseSummaryFromHistory.test.js; this proves the wiring end-to-end.
  test('a PR logged offline is badged, and a later set that only ties the pre-offline best is not', async ({ page, request }) => {
    await registerHousehold(page, request, 'Rowan');
    await logSetAndEndWorkout(page, 'Rowan'); // 45x8 -> comparable 57, the pre-offline best

    await goHardOffline(page);
    await expect(offlineSavedLocallyBanner(page)).toBeVisible();

    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByText(/57 lb/)).toBeVisible();

    const rows = setRowLabels(page);
    const badges = prBadges(page);
    // Deliberately NOT asserted to be 0 here: "This session" can legitimately already carry the
    // pre-offline 45x8 row (the just-ended session's liveSession snapshot can still be the cached
    // one when the screen is opened offline). Every assertion below is relative to what's already
    // there, so the test doesn't care either way.
    const before = await rows.count();

    // 55x8 -> comparable 69.7, comfortably past the 57 pre-offline best.
    await setWeight(page, 55);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(rows).toHaveCount(before + 1);

    // The offline set is the real PR: badged, and the Best card moves with it even though the
    // write is still sitting in the outbox. Asserted via the badge's own row rather than by
    // looking up a row by its weight text -- a 45x8 row can appear more than once on this screen,
    // and "exactly one badge, on the 55 row" is the property that actually matters.
    await expect(badges).toHaveCount(1);
    await expect(badgeRow(page)).toContainText('55 lb × 8');
    await expect(page.getByText(/69.7 lb/)).toBeVisible();

    // Back down to 45x8 -- ties the PRE-offline best (57) but not the real one (69.7), so it must
    // stay unbadged. Before the fix this row is what got the badge instead.
    await setWeight(page, 45);
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(rows).toHaveCount(before + 2);

    await expect(badges).toHaveCount(1);
    await expect(badgeRow(page)).toContainText('55 lb × 8');

    // Draining the outbox reconciles to server truth -- the badge must stay put, not flip.
    await goOnline(page);
    await waitForOutboxDrain(page);
    await expect(badges).toHaveCount(1);
    await expect(badgeRow(page)).toContainText('55 lb × 8');
  });
});
