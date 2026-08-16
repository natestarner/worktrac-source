import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnTimedExercise, logHoldAt, logSetAt, pickExercise, setHoldSeconds } from './support/exercises';
import { goHardOffline, goOnline, waitForOutboxDrain } from './support/offline';

// The "This session" list. Scoping to it matters: the Best card above renders the SAME string
// whenever the hold just logged is also the person's longest, so an unscoped getByText is a
// strict-mode violation rather than a clean assertion.
const setRows = (page: import('@playwright/test').Page) => page.locator('.log-sets-col');

// Duration-tracked exercises: a set measured in seconds held rather than repetitions.
//
// The whole feature is one idea -- an exercise is measured either in reps or in time, and the
// screen tells you which -- so these specs check that the second stepper changes meaning, that a
// hold round-trips as time everywhere it is rendered, and that a rep-tracked exercise is
// completely untouched. Cross-connectivity behaviour lives in parity-endurance.spec.ts.

test.describe('endurance exercises', () => {
  test('a seeded hold logs in seconds and reads back as time', async ({ page, request }) => {
    await registerHousehold(page, request, 'Holt');

    await pickExercise(page, 'Wall Sit');

    // The one visible difference: the second stepper is Time, not Reps.
    await expect(page.getByLabel('Time')).toBeVisible();
    await expect(page.getByLabel('Reps')).toHaveCount(0);

    await logHoldAt(page, 45);

    await expect(page.getByText('Set 1')).toBeVisible();
    await expect(setRows(page).getByText('0:45', { exact: true })).toBeVisible();
  });

  test('the prefill carries the last hold forward, so a target hold is one tap', async ({ page, request }) => {
    await registerHousehold(page, request, 'Wren');
    await pickExercise(page, 'Wall Sit');

    await logHoldAt(page, 60);

    // Second set: the Time field already reads 1:00, so logging it needs no other interaction.
    // This is the "hold to a target" path -- identical in tap count to logging a bench set.
    await expect(page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value')).toHaveValue('1:00');
  });

  test('a weight vest is recorded in the existing weight field, with no new input', async ({ page, request }) => {
    await registerHousehold(page, request, 'Vesta');
    await pickExercise(page, 'Wall Sit');

    await setHoldSeconds(page, 30);
    const weight = page.locator('.stepper-row').filter({ hasText: 'Weight' }).locator('.stepper-value');
    await weight.fill('25');
    await weight.press('Enter');

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(setRows(page).getByText('25 lb × 0:30', { exact: true })).toBeVisible();
  });

  // The deliberate limitation, asserted so it stays deliberate: seconds alone decide the ranking.
  test('a longer hold is a PR; more load at a shorter hold is not', async ({ page, request }) => {
    await registerHousehold(page, request, 'Corin');
    await pickExercise(page, 'Wall Sit');

    await logHoldAt(page, 40);
    await logHoldAt(page, 55);

    // Shorter, so no celebration however much load is added.
    await setHoldSeconds(page, 20);
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 3')).toBeVisible();
    await expect(page.getByText('New PR!')).toHaveCount(0);
  });

  test('the Best card names the record a hold actually has', async ({ page, request }) => {
    await registerHousehold(page, request, 'Dara');
    await pickExercise(page, 'Wall Sit');
    await logHoldAt(page, 75);

    await expect(page.getByText('Best · Longest hold')).toBeVisible();
    // Never an est. 1RM -- Epley over zero reps is meaningless, and seconds presented as pounds is
    // the "rep count wearing a costume" mistake the bodyweight branch already guards against.
    await expect(page.getByText('Best · Est. 1RM')).toHaveCount(0);
  });

  test('a rep-tracked exercise is completely unchanged', async ({ page, request }) => {
    await registerHousehold(page, request, 'Bram');

    // Burpee is new in this change and deliberately rep-tracked -- things you COUNT are reps.
    await pickExercise(page, 'Burpee');
    await expect(page.getByLabel('Reps')).toBeVisible();
    await expect(page.getByLabel('Time')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start timer' })).toHaveCount(0);

    await logSetAt(page, 0, 15);
    await expect(page.getByText('0 lb × 15')).toBeVisible();
  });

  test('a household can add its own timed exercise', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sable');

    await page.getByPlaceholder('Search all exercises').fill('Ring Support Hold');
    await addOwnTimedExercise(page, 'Ring Support Hold');

    await expect(page.getByLabel('Time')).toBeVisible();
    await logHoldAt(page, 20);
    await expect(setRows(page).getByText('0:20', { exact: true })).toBeVisible();
  });

  test('a hold survives being logged offline and reads back as time after syncing', async ({ page, request }) => {
    await registerHousehold(page, request, 'Tovi');
    await pickExercise(page, 'Wall Sit');

    await goHardOffline(page);
    await setHoldSeconds(page, 50);
    await page.getByRole('button', { name: 'Log set' }).click();

    // ⚠️ The row must show the real time while queued, not a blank or a skeleton -- the value is
    // sitting in the mutation's own variables, and pendingBeforeSession is its only source while
    // contextSessionId is null (a person's entire outage).
    await expect(setRows(page).getByText('0:50', { exact: true })).toBeVisible();

    await goOnline(page);
    await waitForOutboxDrain(page);
    await expect(setRows(page).getByText('0:50', { exact: true })).toBeVisible();
  });

  // The Time value opens a min/sec wheel rather than a keyboard. That is not decoration: a
  // numeric keypad has no colon key, so m:ss was never typeable on a phone -- the field displayed
  // "1:30" while the only thing a thumb could produce was "90".
  test('tapping the time opens a minute/second picker, not a keyboard', async ({ page, request }) => {
    await registerHousehold(page, request, 'Wheeler');
    await pickExercise(page, 'Wall Sit');

    const time = page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
    // Read-only is what suppresses the mobile keyboard; without it the picker and the keyboard
    // both appear and fight over the bottom of the screen.
    await expect(time).toHaveAttribute('readonly', '');

    await time.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('listbox', { name: 'Minutes' })).toBeVisible();
    await expect(sheet.getByRole('listbox', { name: 'Seconds' })).toBeVisible();

    // Keyboard-operable, which is the answer to "don't pop an unrequested overlay over a
    // mouse-and-keyboard session" -- typing here is at least as fast as the textbox it replaced.
    const seconds = sheet.getByRole('listbox', { name: 'Seconds' });
    await seconds.focus();
    await seconds.press('4');
    await seconds.press('5');
    await sheet.getByRole('button', { name: 'Done' }).click();

    await expect(time).toHaveValue('0:45');
  });

  // Turning the wheel is not a decision -- only Done is. If closing kept the value, a stray
  // Escape mid-set would silently OVERWRITE a time rather than silently discard an edit.
  //
  // Both exits are checked here because they are now the ONLY two: the sheet has no footer Cancel,
  // since the X already is that button and a second one just widens a row read one-handed mid-set.
  test('dismissing the picker discards the edit', async ({ page, request }) => {
    await registerHousehold(page, request, 'Cass');
    await pickExercise(page, 'Wall Sit');

    const time = page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
    // The field paints blank (an em dash) until the prefill resolves, so capturing the "before"
    // value immediately records "" and this asserts nothing once 0:30 lands a moment later.
    await expect(time).not.toHaveValue('');
    const before = await time.inputValue();

    await time.click();
    const sheet = page.getByRole('dialog');
    const seconds = sheet.getByRole('listbox', { name: 'Seconds' });
    await seconds.focus();
    await seconds.press('4');
    await seconds.press('5');
    await sheet.getByRole('button', { name: 'Close' }).click();

    await expect(sheet).toBeHidden();
    await expect(time).toHaveValue(before);

    // Escape discards too -- it is the same dismissal, so it cannot mean the opposite thing.
    await time.click();
    await sheet.getByRole('listbox', { name: 'Seconds' }).focus();
    await sheet.getByRole('listbox', { name: 'Seconds' }).press('4');
    await page.keyboard.press('Escape');

    await expect(sheet).toBeHidden();
    await expect(time).toHaveValue(before);
  });

  // Clear has to be COMMITABLE or it is a dead end. 0:00 is not a loggable hold (@Min(1) server
  // side, and a 400 is a definitive 4xx that discards the durable write for good), so it commits
  // as the "no value chosen" blank Weight and Reps already use -- an em dash -- rather than
  // rounding up to 0:01 behind your back or disabling the button you just earned.
  test('Clear empties the wheel and Done writes it back to blank', async ({ page, request }) => {
    await registerHousehold(page, request, 'Zeno');
    await pickExercise(page, 'Wall Sit');

    const time = page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
    await expect(time).not.toHaveValue('');
    await time.click();
    const sheet = page.getByRole('dialog');

    await sheet.getByRole('button', { name: 'Clear' }).click();
    // The wheel genuinely shows the empty state rather than snapping back to 0:01.
    await expect(sheet.getByRole('listbox', { name: 'Minutes' }).getByRole('option', { selected: true })).toHaveText('0');
    await expect(sheet.getByRole('listbox', { name: 'Seconds' }).getByRole('option', { selected: true })).toHaveText('0');
    await expect(sheet.getByRole('button', { name: 'Done' })).toBeEnabled();

    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toBeHidden();
    await expect(time).toHaveValue('');

    // Blank is a display state, never a validation gate: Log set still works and logs the default.
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(setRows(page).getByText('0:30', { exact: true })).toBeVisible();
  });

  // The - button empties the field on its last press rather than parking on 0:01, which would
  // read as a deliberate choice and leave the button with nothing left to do.
  test('stepping the time down past zero clears it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Dex');
    await pickExercise(page, 'Wall Sit');

    const time = page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
    await expect(time).toHaveValue('0:30');

    // 0:30 -> 0:05 in five presses, each a real 5s step.
    for (const expected of ['0:25', '0:20', '0:15', '0:10', '0:05']) {
      await page.getByTitle('Decrease Time').click();
      await expect(time).toHaveValue(expected);
    }

    // The sixth press empties it rather than landing on 0:01.
    await page.getByTitle('Decrease Time').click();
    await expect(time).toHaveValue('');

    // And blank is still not a validation gate.
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(setRows(page).getByText('0:30', { exact: true })).toBeVisible();
  });

  // The edit modal's - follows the same rule, and used to be the one control that didn't: it
  // clamped at the minimum, so stepping off the bottom parked on 0:01 and the last press did
  // nothing. What 0:00 MEANS is still different here -- an already-logged set has no blank to fall
  // back on, so Save refuses it rather than the field emptying -- but that is the floor doing its
  // job on the commit, which is where every other duration control already puts it.
  test('editing a hold steps down to 0:00, where Save refuses it', async ({ page, request }) => {
    await registerHousehold(page, request, 'Edda');
    await pickExercise(page, 'Wall Sit');
    await logHoldAt(page, 30);

    await setRows(page).getByRole('button', { name: 'Edit', exact: true }).click();
    const modal = page.getByRole('dialog');
    const time = modal.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
    await expect(time).toHaveValue('0:30');

    for (const expected of ['0:25', '0:20', '0:15', '0:10', '0:05']) {
      await modal.getByTitle('Decrease Time').click();
      await expect(time).toHaveValue(expected);
    }

    // The sixth press reaches 0:00 instead of parking on 0:01 -- and 0:00 is simply not a set the
    // backend will take (@Min(1)), so Save refuses rather than rounding the number up behind you.
    await modal.getByTitle('Decrease Time').click();
    await expect(time).toHaveValue('0:00');
    await expect(modal.getByRole('button', { name: 'Save' })).toBeDisabled();

    // ...and it is a dead end you can walk straight back out of, which is what makes refusing
    // acceptable rather than a trap.
    await modal.getByTitle('Increase Time').click();
    await expect(time).toHaveValue('0:05');
    await modal.getByRole('button', { name: 'Save' }).click();

    await expect(modal).toBeHidden();
    await expect(setRows(page).getByText('0:05', { exact: true })).toBeVisible();
  });

  test('a duration can be picked again after clearing', async ({ page, request }) => {
    await registerHousehold(page, request, 'Reset');
    await pickExercise(page, 'Wall Sit');

    const time = page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
    await expect(time).not.toHaveValue('');
    await time.click();
    const sheet = page.getByRole('dialog');

    await sheet.getByRole('button', { name: 'Clear' }).click();
    const seconds = sheet.getByRole('listbox', { name: 'Seconds' });
    await seconds.focus();
    await seconds.press('2');
    await seconds.press('0');
    await sheet.getByRole('button', { name: 'Done' }).click();

    await expect(time).toHaveValue('0:20');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(setRows(page).getByText('0:20', { exact: true })).toBeVisible();
  });

  test('the hold timer fills the Time field without logging', async ({ page, request }) => {
    await registerHousehold(page, request, 'Lark');
    await pickExercise(page, 'Wall Sit');

    await page.getByRole('button', { name: 'Start timer' }).click();
    await expect(page.getByRole('button', { name: /Stop timer/ })).toBeVisible();

    // The field tracks the running timer. Waiting on the value rather than a fixed sleep keeps
    // this off the clock: any tick past zero proves it is counting.
    const time = page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
    await expect(time).not.toHaveValue('0:00', { timeout: 5000 });

    await page.getByRole('button', { name: /Stop timer/ }).click();

    // Stopping fills the field and nothing else -- a mis-tap must never commit a set.
    await expect(page.getByText(/^Set \d+$/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start timer' })).toBeVisible();
  });

  test('history and the records table read a hold as time', async ({ page, request }) => {
    await registerHousehold(page, request, 'Pell');
    await pickExercise(page, 'Wall Sit');
    await logHoldAt(page, 65);

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('1:05').first()).toBeVisible();

    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page.getByText('Records · holds')).toBeVisible();
    await expect(page.getByText('Longest hold')).toBeVisible();
    // Weight-based rows disappear rather than rendering zeros.
    await expect(page.getByText('Best est. 1RM')).toHaveCount(0);
  });
});
