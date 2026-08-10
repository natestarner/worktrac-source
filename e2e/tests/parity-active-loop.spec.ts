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
// same screen renders "Est. 1RM · 45 lb × 8". PERSON_DEFAULTS starts a person at 45 lb x 8.
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
    await expect(setRow(page, 45)).toBeVisible();
  },
  afterReconnect: async (page) => {
    await expect(editButtons(page)).toHaveCount(1);
    await expect(setRow(page, 45)).toBeVisible();
  },
});

// A FOUND DIVERGENCE, recorded rather than quietly dropped. See the block comment at the bottom
// of this file.
forEachConnectivityMode<void>('a set is still listed under This session after a reload', {
  fixmeModes: ['lie-fi', 'pinned-offline'],
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Rafferty');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await page.getByRole('button', { name: /Log set/ }).click();
    await expect(setRow(page, 45)).toBeVisible();
  },
  assert: async (page) => {
    await expect(setRow(page, 45)).toBeVisible();
  },
  afterReconnect: async (page) => {
    await page.reload();
    await expect(setRow(page, 45)).toBeVisible();
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
    // +5 lb per click on the weight stepper (PERSON_DEFAULTS starts at 45).
    await dialog.locator('.stepper-row').first().getByRole('button', { name: '+' }).click();
    await dialog.locator('.stepper-row').first().getByRole('button', { name: '+' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
  },
  assert: async (page) => {
    await expect(setRow(page, 55)).toBeVisible();
    await expect(editButtons(page)).toHaveCount(1);
  },
  afterReconnect: async (page) => {
    // If the edit had been swallowed by idempotency dedup on the create's key -- the 2026-07-30
    // bug -- the corrected value would have reverted to 45 lb once the outbox drained.
    await expect(setRow(page, 55)).toBeVisible();
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

// ---------------------------------------------------------------------------------------------
// FOUND BY THIS HARNESS, on its first run -- the "still listed after a reload" spec above.
//
// Log a set during lie-fi or while pinned offline, reconnect, let the outbox drain, then reload:
// the set is GONE from "This session", even though it reached the server. The page snapshot proves
// the write landed -- the summary reads "Last time · Today 45lb×8" and the Est. 1RM updated -- so
// nothing is lost. What is missing is the current session's own set list. Online and hard-offline
// both repopulate it correctly; only the two modes where the session never had a server-issued id
// during the write fail. Reproducible at --workers=1, so it is not the known worker contention.
//
// Consistent with two documented mechanisms compounding, which is this codebase's signature
// failure shape:
//   - `contextSessionId` stays null for the whole degraded stretch, so the `sessionSets` query
//     keyed on it never runs (frontend-core.md, "A durable write is not the same as a visible
//     value").
//   - A rehydrated cache entry keeps its old `dataUpdatedAt`, so it "claims to be seconds old" and
//     satisfies every staleness check on boot -- and `sessionSets` is session-scoped, so it is
//     neither cache-warmed nor on the `refreshAfterRestore` opt-in list
//     (docs/incidents/2026-08-08-restored-cache-looks-fresh.md).
//
// Deliberately NOT fixed here: it sits in ExerciseDetail/queryClient cache logic, the densest file
// in the app for cross-cutting invariants and the origin of most of docs/incidents/. A speculative
// fix is exactly the kind of change that has caused the seesawing this work exists to stop. It is
// recorded as a fixme with a reproduction so the next person starts from evidence, not a guess.
// ---------------------------------------------------------------------------------------------
