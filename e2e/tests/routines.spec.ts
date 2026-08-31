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

  // The grip handle's arrow-key path is covered in RoutineFormModal.test.jsx -- jsdom never lays
  // out real geometry, so it can't drive dnd-kit's PointerSensor. This is the one place an actual
  // pointer drag is exercised, in a real browser with real layout.
  test('drag a grip handle to reorder exercises, and the new order survives the save', async ({ page, request }) => {
    await registerHousehold(page, request, 'Avery');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Drag Day');

    await addExerciseToRoutine(page, 'Barbell Bench Press');
    await addExerciseToRoutine(page, 'Dumbbell Overhead Press');
    await addExerciseToRoutine(page, 'Barbell Back Squat');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Remove: Barbell Bench Press (1 of 3)' })).toBeVisible();

    // Drag the first row's handle down onto the third row -- past the second row on the way,
    // which is the point: dnd-kit only commits a reorder on drop, so passing over row 2 en route
    // must not leave it there.
    const sourceHandle = dialog.getByRole('button', { name: 'Reorder: Barbell Bench Press (1 of 3)' });
    const targetHandle = dialog.getByRole('button', { name: 'Reorder: Barbell Back Squat (3 of 3)' });
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetHandle.boundingBox();
    if (!sourceBox || !targetBox) throw new Error('Grip handle has no layout box');

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
    await page.mouse.up();
    // A real drag ends with a real hand lifting off and moving elsewhere before the next tap --
    // Playwright's scripted mouse.up() -> click() has no equivalent pause. Give the page one
    // settle window before the very next interaction.
    await page.waitForTimeout(300);

    // Bench Press dropped onto Squat's slot -> Overhead Press and Squat both shift up one.
    await expect(dialog.getByRole('button', { name: 'Remove: Dumbbell Overhead Press (1 of 3)' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Remove: Barbell Back Squat (2 of 3)' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Remove: Barbell Bench Press (3 of 3)' })).toBeVisible();

    await page.getByRole('button', { name: 'Save routine' }).click();
    await expect(page.getByText('Dumbbell Overhead Press, Barbell Back Squat, Barbell Bench Press')).toBeVisible();
  });

  // Bailing out of a routine partway through. The only exit used to be "Finish routine", which
  // appears on the LAST step alone -- so leaving a 3-exercise routine at step 1 meant stepping
  // through the other two, or scrubbing the pill strip to its end and tapping in. This asserts
  // the exit is reachable from the FIRST step, which is what makes it an early exit at all.
  test('end a routine early, from the first exercise, without stepping to the end', async ({ page, request }) => {
    await registerHousehold(page, request, 'Riley');

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Long Day');
    await addExerciseToRoutine(page, 'Barbell Bench Press');
    await addExerciseToRoutine(page, 'Dumbbell Overhead Press');
    await addExerciseToRoutine(page, 'Barbell Back Squat');
    await page.getByRole('button', { name: 'Save routine' }).click();

    await page.getByRole('button', { name: 'Start routine' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('1 of 3')).toBeVisible();

    // The point of the whole change: at step 1 there is no "Finish routine" anywhere, and there
    // does not need to be.
    await expect(page.getByRole('button', { name: 'Finish routine' })).toHaveCount(0);
    await page.getByRole('button', { name: 'End routine' }).click();

    await expect(page.getByText('Routine ended.', { exact: true })).toBeVisible();
    await expect(page.getByText('1 of 3')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'End routine' })).toHaveCount(0);

    // Ending the routine is not ending the workout, and it doesn't yank you off the exercise you
    // were on -- the set logger is still right there to keep using off-script.
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 1', { exact: true })).toBeVisible();

    // And the routine is restartable from the picker, so ending early costs nothing permanent.
    // The picker's quick-start list is itself the proof the routine really ended: ExercisePicker
    // renders it only when NO routine is active (`showRoutineQuickStart`), and it's suppressed for
    // the entire life of one. Its rows are labelled "<name> Start →", not "Start routine" -- that
    // button belongs to the Routines tab.
    await page.getByText('New PR!').click({ force: true }); // dismiss (scrim click)
    await page.getByRole('button', { name: /All exercises/ }).click();
    await expect(page.getByText('Start a routine', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Long Day/ })).toBeVisible();
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
