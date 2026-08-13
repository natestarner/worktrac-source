import { Page, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// PARITY specs: one assertion body, run across online / lie-fi / hard-offline / pinned-offline.
//
// Every other offline spec in this suite is written as "do X offline, assert an offline-shaped
// outcome, reconnect, assert it lands" -- which proves the offline path works, but never that it
// produces the SAME user-visible result as online. That gap is why a set could badge as a PR
// online and not offline (#134), and why editing a queued set was claimed to behave "identically
// in every connectivity mode" (docs/incidents/2026-07-30-editing-queued-offline-set.md) with
// nothing verifying it.
//
// The assertions below deliberately contain NO branching on ctx.mode. If one ever needs a branch,
// that is a real divergence and belongs on the register in .claude/rules/resilience.md -- not in
// an `if` here.
//
// Note what is NOT asserted here: the outbox badge, "Saving…", and the offline banner all
// legitimately differ by mode. Parity is about the RESULT of the user's action, not the sync
// chrome around it. Those are covered by offline-outbox / offline-mode / intermittent-errors.

const EXERCISE = 'Barbell Bench Press';

// Every locator here is exact-matched, and person names are kept clear of the strings the
// assertions look for. Both are load-bearing, not style (see .claude/rules/e2e-tests.md):
//   - Playwright matches an accessible name by case-insensitive SUBSTRING, so 'Edit' also matches
//     the "Edit note…" control on the same screen -- toHaveCount(1) saw 3.
//   - getByText is a substring match too, so a person called "Parity Noter" collides with a note
//     reading "Parity note", and the header's own person button wins the match.
const NOTE_TEXT = 'Felt strong today';
const editButtons = (page: Page) => page.getByRole('button', { name: 'Edit', exact: true });
const deleteButtons = (page: Page) => page.getByRole('button', { name: 'Delete', exact: true });

// The logged-set row renders as "<weight> lb × <reps>". Exact again -- the Est. 1RM readout on the
// same screen renders it inside a longer string.
//
// The weight here is 0 because these specs deliberately log at whatever the prefill offers, and a
// brand-new exercise now has no prefill at all (computePrefillDraft returns null -- see
// utils/formulas.js). A blank weight logs as 0, i.e. a bodyweight set, which is exactly the path a
// person hits on their first-ever pull-up. What is under test here is that the ROW is identical in
// every connectivity mode; the number itself is incidental, and the specs that do care about the
// number (offline-reads, offline-active-loop) set it explicitly.
const setRow = (page: Page, weight: number, reps = 8) =>
  page.getByText(`${weight} lb × ${reps}`, { exact: true });

// Loads the exercise catalog while still online, so the in-mode search has something to filter.
// ExercisePicker searches CLIENT-SIDE over the single `exercises` query and renders results only
// once that query is out of `loading` -- so a mode entered before the boot cache-warm finished
// leaves the picker permanently empty. That is correct app behaviour (nothing was cached yet), but
// it makes the test measure the warm race instead of the flow, so pay it explicitly and online.
async function warmCatalog(page: Page) {
  const search = page.getByPlaceholder('Search all exercises');
  await search.fill(EXERCISE);
  await expect(page.getByRole('button', { name: EXERCISE, exact: true })).toBeVisible();
  await search.fill('');
}

// The single most-used flow in the app. `frontend-core.md` states the invariant this pins down:
// once a write is queued, its row "gets Edit/Delete controls immediately -- as durable/editable
// as a synced row". That is a parity claim, and this is the test of it.
forEachConnectivityMode<void>('logging a set produces the same row', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Marlowe');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await page.getByRole('button', { name: /Log set/ }).click();
  },
  assert: async (page) => {
    // Same row, same default weight, and immediately editable -- in every mode.
    await expect(page.getByText('Set 1', { exact: true })).toHaveCount(1);
    await expect(editButtons(page)).toHaveCount(1);
    await expect(deleteButtons(page)).toHaveCount(1);
    await expect(setRow(page, 0)).toBeVisible();
  },
  afterReconnect: async (page) => {
    await expect(editButtons(page)).toHaveCount(1);
    await expect(setRow(page, 0)).toBeVisible();
  },
});

// The carry-forward: on an exercise with no prior session, the weight for set N+1 comes from set N
// of TODAY, not back to the empty default. That rule reads ExerciseDetail's `displaySets`, and
// reading `sessionSets` instead would make it work online and silently do nothing in every
// degraded mode -- `contextSessionId` stays null for the whole outage, so the sessionSets query
// never runs and its data stays `[]` however many sets are logged. Exactly the class of divergence
// this harness exists to catch, so it is asserted across all four modes rather than asserted once
// and assumed.
forEachConnectivityMode<void>("the weight carries forward from today's previous set", {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Winslow');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    // Set 1 logs at the blank default (0). Step it up before set 2 so the carried value is
    // distinguishable from the default it would otherwise fall back to.
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByText('Set 1', { exact: true })).toHaveCount(1);

    const weightRow = page.locator('.stepper-row').filter({ hasText: 'Weight' });
    await expect
      .poll(async () => {
        const current = Number(await weightRow.locator('.stepper-value').inputValue());
        if (current === 25) return current;
        await weightRow.getByRole('button', { name: current < 25 ? '+' : '−', exact: true }).click();
        return Number(await weightRow.locator('.stepper-value').inputValue());
      }, { timeout: 15000 })
      .toBe(25);

    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(page.getByText('Set 2', { exact: true })).toHaveCount(1);
  },
  assert: async (page) => {
    // The draft did NOT snap back to blank after set 2 was logged.
    await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('25');
    await expect(setRow(page, 25)).toBeVisible();
  },
  afterReconnect: async (page) => {
    await expect(setRow(page, 25)).toBeVisible();
  },
});

// Regression coverage for docs/incidents/2026-08-12-provisional-live-session-restored-as-fresh.md.
// See the block comment at the bottom of this file for what this caught and how.
forEachConnectivityMode<void>('a set is still listed under This session after a reload', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Rafferty');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(setRow(page, 0)).toBeVisible();
    // Load-bearing, and deliberately the OPPOSITE of offline-durability's "reload IMMEDIATELY".
    // The bug needs the provisional { id: null } liveSession to have actually reached disk, and the
    // query persister is throttled to one write per second (persistOptions in lib/queryClient.js).
    // Reconnect inside that window and the reload restores a snapshot with no liveSession entry at
    // all -- the query then fetches on mount and the bug cannot show. That is exactly why this
    // originally looked like a lie-fi/pinned-offline divergence: those modes take seconds to drain,
    // the other two took under one. Keep this above the persister's throttleTime; if that value
    // ever changes, this must change with it.
    await page.waitForTimeout(1200);
  },
  assert: async (page) => {
    await expect(setRow(page, 0)).toBeVisible();
  },
  afterReconnect: async (page) => {
    await page.reload();
    await expect(setRow(page, 0)).toBeVisible();
  },
});

// The invariant 2026-07-30 claims and nothing tested: correcting a set behaves the same whether
// its create is already synced (online) or still queued (every degraded mode). Online this edits a
// synced row; degraded it edits a row whose create is still in the outbox, via a separate durable
// EDIT_SET keyed on the create's temp id. The user must not be able to tell.
forEachConnectivityMode<void>('correcting a just-logged set applies immediately', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Sutton');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(editButtons(page)).toHaveCount(1);

    await editButtons(page).click();
    const dialog = page.getByRole('dialog');
    // +5 lb per click on the weight stepper, starting from the logged 0.
    await dialog.locator('.stepper-row').first().getByRole('button', { name: '+' }).click();
    await dialog.locator('.stepper-row').first().getByRole('button', { name: '+' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
  },
  assert: async (page) => {
    await expect(setRow(page, 10)).toBeVisible();
    await expect(editButtons(page)).toHaveCount(1);
  },
  afterReconnect: async (page) => {
    // If the edit had been swallowed by idempotency dedup on the create's key -- the 2026-07-30
    // bug -- the corrected value would have reverted to the logged 0 once the outbox drained.
    await expect(setRow(page, 10)).toBeVisible();
    await expect(editButtons(page)).toHaveCount(1);
  },
});

// Two more durable writes that are not set-logging, to prove the parity is a property of the
// outbox rather than of one lucky mutation.
forEachConnectivityMode<void>('favoriting and adding a session note both show immediately', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Ellis');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(editButtons(page)).toHaveCount(1);

    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await page.getByRole('button', { name: 'Add a note for this session' }).click();
    await page.getByPlaceholder('Write a note...').fill(NOTE_TEXT);
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  },
  assert: async (page) => {
    await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
    await expect(page.getByText(NOTE_TEXT, { exact: true })).toBeVisible();
  },
  afterReconnect: async (page) => {
    await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
    await expect(page.getByText(NOTE_TEXT, { exact: true })).toBeVisible();
  },
});

// Switching exercises must never leave the previous exercise's weight/reps in the steppers. The
// draft is per-PERSON state living above the router, so it survives both switch paths -- the
// picker (which unmounts ExerciseDetail) and the routine strip (which does not) -- and only the
// stamp on it says which exercise it describes.
//
// Asserted across all four modes because the window this shows in is bounded by how long the new
// exercise's summary takes to resolve, and that is precisely what degrades: online it is a frame,
// under lie-fi it is the whole retry budget before the derived-from-history fallback takes over.
// A single online assertion would be the weakest possible version of this test.
forEachConnectivityMode<void>('switching exercises never shows the previous one\'s weight', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Thackeray');
    await warmCatalog(page);
    // Warm the second exercise too -- the picker filters client-side over one cached query, so an
    // exercise never fetched while online is simply absent from the list in a degraded mode.
    const search = page.getByPlaceholder('Search all exercises');
    await search.fill('Pull-up');
    await expect(page.getByRole('button', { name: 'Pull-up', exact: true })).toBeVisible();
    await search.fill('');
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    // Put a distinctive, unmistakably-not-a-default number in the draft, then leave for an
    // exercise that has no history at all. 25 is reachable by stepping, which works in every mode.
    const weightRow = page.locator('.stepper-row').filter({ hasText: 'Weight' });
    await expect
      .poll(async () => {
        const current = Number(await weightRow.locator('.stepper-value').inputValue());
        if (current === 25) return current;
        await weightRow.getByRole('button', { name: current < 25 ? '+' : '−', exact: true }).click();
        return Number(await weightRow.locator('.stepper-value').inputValue());
      }, { timeout: 15000 })
      .toBe(25);

    await page.getByRole('button', { name: '← All exercises' }).click();

    // Record the weight field's value on every animation frame from here on. Installed on the
    // PICKER, where ExerciseDetail is unmounted and no weight input exists, so every sample
    // collected below necessarily belongs to the pull-up screen -- starting a frame earlier
    // records the bench press's own legitimate 25 and fails against correct code.
    //
    // A retrying matcher cannot test this: the stale value corrects itself as soon as the new
    // exercise's summary resolves, so `toHaveValue('')` simply waits the bug out and passes --
    // verified, this spec did exactly that before this sampler existed. Sampling per frame pins
    // the actual claim, which is about what gets PAINTED, and needs no per-mode timing knowledge:
    // however long the window is in this mode, every frame of it is inspected.
    await page.evaluate(() => {
      const seen = new Set();
      window.__weightSamples = seen;
      const sample = () => {
        const el = document.querySelector('input[aria-label^="Weight"]');
        if (el) seen.add(el.value);
        window.__weightSampler = requestAnimationFrame(sample);
      };
      sample();
    });

    await pickExercise(page, 'Pull-up');
  },
  assert: async (page) => {
    // Pull-up has no history in any mode, so the em dash is the one correct answer everywhere.
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('');

    // ...and it must have been the answer for every frame, not just the one this assertion
    // happened to land on. '25' here is the bench press's draft wearing the pull-up's name.
    const painted = await page.evaluate(() => {
      cancelAnimationFrame(window.__weightSampler);
      return [...window.__weightSamples];
    });
    expect(painted).not.toContain('25');
  },
});

// ---------------------------------------------------------------------------------------------
// FOUND BY THIS HARNESS on its first run, recorded as a fixme with a reproduction rather than
// blind-patched, and fixed on 2026-08-12 once that reproduction had been instrumented. Full
// narrative: docs/incidents/2026-08-12-provisional-live-session-restored-as-fresh.md.
//
// The bug: log a set while degraded, reconnect, let the outbox drain, reload -- and the set is GONE
// from "This session" even though it reached the server. `logSetMutation.onMutate` seeds a
// provisional `{ id: null }` liveSession, that entry gets persisted like any other, and after a
// reload its `dataUpdatedAt` (the moment the CLIENT invented it) satisfies every freshness check
// there is. Nothing refetches, so `contextSessionId` stays null, `sessionSets` never runs, and the
// list is empty. Fixed in useLiveSession.js: a session with no server id can never be fresh.
//
// Two things the original note got wrong, both worth keeping as cautionary tales:
//
//   1. "Only lie-fi and pinned-offline fail" was wrong: ALL THREE degraded modes are exposed, and
//      hard-offline was merely escaping on timing. The bug needs the placeholder to have reached
//      disk, and the persister is throttled to 1s -- lie-fi's retry backoff makes its runs take
//      seconds, while hard-offline finished in under one, so its reload restored a snapshot with no
//      liveSession entry at all and the query simply fetched. The 1.2s in-mode wait in `act` above
//      is what makes all three reproduce. Online is the only mode that is structurally safe: there
//      the placeholder lives ~50ms before onSuccess's refetchLiveSession replaces it with the real
//      session, so it is never what gets persisted. Verified by reverting the fix: 3 failed, 1
//      passed.
//
//   2. Three of the four modes were passing this spec VACUOUSLY. `waitForOutboxDrain` returned
//      while the write was still in flight (see its comment in support/offline.ts), so the reload
//      landed with the write still in the outbox and the row after it came from restoreOutbox's
//      replay rather than from the server. Only lie-fi -- whose write has failureCount > 0 and so
//      stays counted -- was actually testing the thing. That gate is now honest, which is what let
//      hard-offline reproduce at all.
//
// The moral for the next divergence this harness finds: a fixme with a reproduction is the right
// call, but confirm the reproduction is measuring what it claims before trusting its shape. The
// per-mode pattern here pointed at a mechanism that did not exist.
// ---------------------------------------------------------------------------------------------
