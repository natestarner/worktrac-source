import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';

// Exercise notes are two independent, coexisting features (see CLAUDE.md's Data Model
// Notes): a standing per-person note shown every session, and a per-session note scoped
// to one workout. This spec drives the full golden path: set both, confirm a session note
// materializes the live session before any set is logged, confirm the previous session's
// note surfaces in the "Last time" card and in History, then delete it via the note editor
// reachable from History's "Edit" flow.
test.describe('Exercise notes', () => {
  test('standing note + session note round-trip through Last time, History, and delete', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    // --- Standing (persistent) note, set via the Customize modal ---
    await page.getByRole('button', { name: 'Customize this exercise' }).click();
    const standingNoteInput = page.getByPlaceholder('e.g. Keep elbows tucked, bad knee -- go light');
    await standingNoteInput.fill('Keep elbows tucked, pause at chest');
    const standingNoteSaved = page.waitForResponse(
      (r) => r.url().includes('/exercises/') && r.url().endsWith('/note') && r.request().method() === 'PUT',
    );
    await standingNoteInput.blur();
    await standingNoteSaved;
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

    await expect(page.getByText('Keep elbows tucked, pause at chest')).toBeVisible();

    // --- Session note, set via the header glyph BEFORE any set is logged -- must
    // materialize a live session on its own (SessionExerciseNoteService.upsertLiveNote). ---
    await expect(page.getByText('Session in progress')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add a note for this session' }).click();
    await page.getByPlaceholder('Write a note...').fill('Shoulder felt off today, cut it short');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Shoulder felt off today, cut it short')).toBeVisible();
    await expect(page.getByText('Session in progress')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit note for this session' })).toBeVisible();

    // Log a set into this (now-materialized) session, then end the workout.
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();

    // --- A brand new session should show the standing note (always) but not the old
    // session note, and the "Last time" card should surface the PREVIOUS session's note. ---
    await page.getByRole('button', { name: '← All exercises' }).click();
    await pickExercise(page, 'Barbell Bench Press');

    await expect(page.getByText('Keep elbows tucked, pause at chest')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a note for this session' })).toBeVisible(); // ghosted again -- new session
    await expect(page.getByText('Shoulder felt off today, cut it short')).toBeVisible(); // now in the Last time card

    // --- History shows the note inline next to the exercise name for that past session. ---
    await page.getByRole('link', { name: 'History' }).click();
    // Wait for a History-only marker first, so the note check below can't catch a
    // mid-transition DOM state where the previous route's elements haven't fully
    // unmounted yet (seen as a flaky strict-mode double-match under parallel workers).
    await expect(page.getByRole('button', { name: '+ Log a past workout' })).toBeVisible();
    await expect(page.getByText('Shoulder felt off today, cut it short')).toBeVisible();

    // --- Delete the session note via History's "Edit" -> the exercise's note glyph. All
    // editing routes through the Log screen; History itself stays read-only. ---
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('Editing past session')).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();

    await expect(page.getByRole('button', { name: 'Edit note for this session' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit note for this session' }).click();
    await expect(page.getByPlaceholder('Write a note...')).toHaveValue('Shoulder felt off today, cut it short');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete note' }).click();

    await expect(page.getByRole('button', { name: 'Add a note for this session' })).toBeVisible();
    await expect(page.getByText('Shoulder felt off today, cut it short')).toHaveCount(0);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/app\/history/);
    await expect(page.getByText('Shoulder felt off today, cut it short')).toHaveCount(0);

    // The standing note is untouched by any of the session-note deletion above.
    await page.getByRole('link', { name: 'Log' }).click();
    await pickExercise(page, 'Barbell Bench Press');
    await expect(page.getByText('Keep elbows tucked, pause at chest')).toBeVisible();
  });

  test('a blank standing note clears it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await pickExercise(page, 'Barbell Bench Press');

    await page.getByRole('button', { name: 'Customize this exercise' }).click();
    const standingNoteInput = page.getByPlaceholder('e.g. Keep elbows tucked, bad knee -- go light');
    await standingNoteInput.fill('Go light -- bad knee');
    let saved = page.waitForResponse((r) => r.url().endsWith('/note') && r.request().method() === 'PUT');
    await standingNoteInput.blur();
    await saved;
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Go light -- bad knee')).toBeVisible();

    await page.getByRole('button', { name: 'Customize this exercise' }).click();
    await standingNoteInput.fill('');
    saved = page.waitForResponse((r) => r.url().endsWith('/note') && r.request().method() === 'PUT');
    await standingNoteInput.blur();
    await saved;
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

    await expect(page.getByText('Go light -- bad knee')).toHaveCount(0);
  });
});
