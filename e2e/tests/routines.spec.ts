import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addExerciseToRoutine } from './support/exercises';

// The header's account-holder dropdown trigger shows the primary person's name too, so
// an unscoped getByRole('button', { name: /Name/ }) can match both it and that person's
// pill here -- scope to .person-pill-bar (the pill row's own container) to disambiguate.
function personPill(page, name: string) {
  return page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) });
}

test.describe('Routines', () => {
  test('create a routine, start it, and step through to completion', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();

    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');

    // iOS Safari auto-zooms the page on focus for any input under 16px font-size -- lock
    // this in so a future style tweak can't reintroduce that.
    await expect(page.getByPlaceholder('Search all exercises')).toHaveCSS('font-size', '16px');

    await addExerciseToRoutine(page, 'Barbell Bench Press');

    // Adding an exercise clears the search box, so it's ready for the next search
    // instead of still showing the previous term.
    await expect(page.getByPlaceholder('Search all exercises')).toHaveValue('');

    await addExerciseToRoutine(page, 'Dumbbell Overhead Press');
    await page.getByRole('button', { name: 'Save routine' }).click();

    await expect(page.getByText('Push Day')).toBeVisible();
    await expect(page.getByText('Barbell Bench Press, Dumbbell Overhead Press')).toBeVisible();

    await page.getByRole('button', { name: 'Start routine' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('1 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    await page.getByRole('button', { name: 'Next exercise' }).click();
    await expect(page.getByText('2 of 2')).toBeVisible();

    await page.getByRole('button', { name: 'Finish routine' }).click();
    await expect(page.getByText('Routine complete!')).toBeVisible();
  });

  // A routine is meant to walk you through a whole workout, and plenty of workouts cycle back to
  // the same lift (bench, row, bench). The builder used to remove an exercise from the picker the
  // moment it was added, which made that unbuildable. Nothing in the schema ever forbade it --
  // routine_exercises has no unique index on (routine_id, exercise_id) -- and the in-workout
  // stepper was already index-based, so this covers the whole path end to end.
  test('build a routine that repeats an exercise and step through every position', async ({ page, request }) => {
    await registerHousehold(page, request, 'Quinn');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Cycle');

    await addExerciseToRoutine(page, 'Barbell Bench Press');
    await addExerciseToRoutine(page, 'Dumbbell Overhead Press');
    // The same exercise a second time -- the chip/search row is still there to tap.
    await addExerciseToRoutine(page, 'Barbell Bench Press');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Remove: Barbell Bench Press (1 of 3)' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Remove: Barbell Bench Press (3 of 3)' })).toBeVisible();

    await page.getByRole('button', { name: 'Save routine' }).click();

    // Order survives the round trip, duplicate included.
    await expect(page.getByText('Barbell Bench Press, Dumbbell Overhead Press, Barbell Bench Press')).toBeVisible();

    await page.getByRole('button', { name: 'Start routine' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('1 of 3')).toBeVisible();

    // Log at position 1, walk to position 3 (the same exercise again), and log there too. Both
    // sets belong to one exercise in one session, so the second position resumes the first's list
    // rather than starting a fresh one -- that is the point of cycling back.
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1', { exact: true })).toBeVisible();
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)

    await page.getByRole('button', { name: 'Next exercise' }).click();
    await expect(page.getByText('2 of 3')).toBeVisible();

    await page.getByRole('button', { name: 'Next exercise' }).click();
    await expect(page.getByText('3 of 3')).toBeVisible();

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 2', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Finish routine' }).click();
    await expect(page.getByText('Routine complete!')).toBeVisible();
  });

  test('copy a routine to another person and it appears independently in their routine list', async ({ page, request }) => {
    await registerHousehold(page, request, 'Jordan');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    await personPill(page, 'Jordan').click();
    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Push Day');
    await addExerciseToRoutine(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: 'Save routine' }).click();
    await expect(page.getByText('Push Day', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Copy to…' }).click();
    await page.getByRole('checkbox', { name: 'Sam' }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByText(/Copied.*Sam/)).toBeVisible();

    await personPill(page, 'Sam').click();
    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page.getByText('Push Day', { exact: true })).toBeVisible();
    await expect(page.getByText('Barbell Bench Press')).toBeVisible();

    // Independence: deleting Jordan's original doesn't touch Sam's copy.
    await personPill(page, 'Jordan').click();
    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    // exact: true -- a plain substring match also catches the still-fading toast
    // ("Copied "Push Day" to Sam") and the confirm dialog's own message
    // ("Delete "Push Day"? ..."), both of which legitimately contain this text.
    await expect(page.getByText('Push Day', { exact: true })).not.toBeVisible();

    await personPill(page, 'Sam').click();
    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page.getByText('Push Day', { exact: true })).toBeVisible();
  });
});
