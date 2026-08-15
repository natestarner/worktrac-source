import { Page, expect } from '@playwright/test';

// After the favorites redesign, a newly-registered person's Log picker is empty (it only shows
// their favorites and previously-logged exercises). Selecting an exercise for the first time
// means searching the catalog, then tapping the result chip. Works whether or not the exercise
// is already in the person's list.
export async function pickExercise(page: Page, name: string) {
  await page.getByPlaceholder('Search all exercises').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

// The routine builder's "Add exercise to routine" pool likewise defaults to favorites/logged,
// so search the catalog, then tap the result row (search results render as a plain-name list,
// same as the Log picker -- the "+ Name" chip styling only applies to the default
// favorites/logged view, not search results).
export async function addExerciseToRoutine(page: Page, name: string) {
  await page.getByPlaceholder('Search all exercises').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

// Create a custom exercise via the always-present "+ Add your own exercise" button (on the Log
// picker or the routine modal). Creating it auto-favorites it and opens its detail screen.
export async function addOwnExercise(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add your own exercise' }).click();
  await page.getByPlaceholder('Exercise name').fill(name);
  // The modal has a setup-field "Add" chip button and the submit "Add" button; submit is last.
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();
}

// 'Time' is the second stepper for a duration-tracked exercise (a plank), where it replaces
// 'Reps'. It does not collide with the .stepper-row text filter below: no row's label contains
// another's.
export type StepperLabel = 'Weight' | 'Reps' | 'Time';

// Weight/reps are steppers with a real <input> for the value (it selects its text on focus, so
// typing replaces the prefill instead of appending to it -- see WeightRepsStepper.jsx). `fill`
// overwrites the whole value directly regardless of that, so it's just fill + commit; the input
// commits on blur/Enter, not on every keystroke, hence the trailing `press('Enter')`. Wrapped in
// expect.poll because ExerciseDetail's computePrefillDraft effect re-seeds the draft when the
// summary / session-sets queries settle, which can land after this and stomp the value -- the
// same race offline-reads.spec.ts's setWeight documents.
export async function setStepper(page: Page, label: StepperLabel, target: number) {
  const row = page.locator('.stepper-row').filter({ hasText: label });
  const value = row.locator('.stepper-value');

  await expect
    .poll(
      async () => {
        if (Number(await value.inputValue()) === target) return target;
        await value.fill(String(target));
        await value.press('Enter');
        return Number(await value.inputValue());
      },
      { timeout: 20000 },
    )
    .toBe(target);
}

function stepperValue(page: Page, label: StepperLabel) {
  return page.locator('.stepper-row').filter({ hasText: label }).locator('.stepper-value');
}

// Sets BOTH steppers, then re-checks them together.
//
// setStepper on its own is not enough. It polls until the value it typed reads back, but
// computePrefillDraft re-seeds the draft whenever the summary / session-sets queries settle, and
// that can land *after* the poll succeeded and *before* the "Log set" click. Locally those queries
// return in milliseconds so the race is almost never lost; against a deployed backend it is, and
// the set is silently logged at the 45 lb prefill default instead of the target.
//
// Re-verifying the pair after both are set is what closes the window that matters: a re-seed
// stomps BOTH fields, so checking reps also catches a stomped weight.
async function setStepperPair(page: Page, weight: number, reps: number) {
  await expect
    .poll(
      async () => {
        if (Number(await stepperValue(page, 'Weight').inputValue()) !== weight) {
          await setStepper(page, 'Weight', weight);
        }
        if (Number(await stepperValue(page, 'Reps').inputValue()) !== reps) {
          await setStepper(page, 'Reps', reps);
        }
        const w = await stepperValue(page, 'Weight').inputValue();
        const r = await stepperValue(page, 'Reps').inputValue();
        return `${Number(w)}x${Number(r)}`;
      },
      { timeout: 30000 },
    )
    .toBe(`${weight}x${reps}`);
}

// Logs one set at an exact weight/reps. Every caller so far logs strictly increasing bests, so the
// PR celebration fires each time and must be dismissed before the next set can be logged.
//
// Use this rather than driving setStepper yourself -- see setStepperPair above for why, and note
// the failure mode is remote from the cause: a 315x2 logged as 45x2 is no longer a PR, so what you
// actually see is a missing celebration or a records/sort assertion reading a number nobody typed.
export async function logSetAt(page: Page, weight: number, reps: number) {
  const setRows = page.getByText(/^Set \d+$/);
  const rowsBefore = await setRows.count();

  await setStepperPair(page, weight, reps);
  await page.getByRole('button', { name: 'Log set' }).click();

  const celebration = page.getByText('New PR!');
  await expect(celebration).toBeVisible();
  await celebration.click({ force: true });
  await expect(celebration).toBeHidden();

  // Wait for this set's own row before returning, so the prefill re-seed that THIS write triggers
  // has already fired by the time the next call starts typing -- otherwise the race just moves to
  // the following set.
  await expect(setRows).toHaveCount(rowsBefore + 1);
}


// The Time stepper shows m:ss in both states. Tapping it opens the min/sec wheel
// (DurationWheel) rather than a keyboard, because a phone's numeric keypad has no colon key --
// which is the whole reason the picker exists. The field itself stays a real <input>, read-only,
// so `inputValue()` still reads the committed value back; only `fill()` no longer applies.
function asClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Drives the wheel by DIGIT TYPEAHEAD, not by scrolling and not by N arrow presses. Scroll-driving
// a scroll-snap container from Playwright means racing momentum and snap physics for a value we
// then have to read back -- inherently flaky, and slow. Typing "4" "5" into the seconds column is
// one deterministic step, and it exercises the same keyboard interface that answers the
// "unrequested overlay over a mouse-and-keyboard session" objection in the app itself.
export async function setHoldSeconds(page: Page, target: number) {
  const value = page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
  const expected = asClock(target);

  await expect
    .poll(
      async () => {
        if ((await value.inputValue()) === expected) return expected;

        await value.click();
        const sheet = page.getByRole('dialog');
        await expect(sheet).toBeVisible();

        // Both columns every time, including a zero: the wheel keeps whatever the field already
        // held, so leaving a column untouched leaves the PREVIOUS set's minutes in place.
        for (const [name, digits] of [
          ['Minutes', String(Math.floor(target / 60))],
          ['Seconds', String(target % 60)],
        ] as const) {
          const column = sheet.getByRole('listbox', { name });
          // focus(), not click(): the column's centre is an option row, and clicking it would
          // select whatever happens to be sitting in the selection band. Focusing also blurs the
          // other column, which resets its typeahead buffer -- so these digits mean the same
          // thing on a retry as they did on the first attempt.
          await column.focus();
          for (const digit of digits) await column.press(digit);
        }

        await sheet.getByRole('button', { name: 'Done' }).click();
        await expect(sheet).toBeHidden();
        return value.inputValue();
      },
      { timeout: 20000 },
    )
    .toBe(expected);
}

// logSetAt's counterpart for a duration-tracked exercise: logs one hold at an exact number of
// seconds. Kept separate rather than overloading logSetAt because the two take different measures
// and the PR celebration copy differs -- a hold has no est. 1RM.
export async function logHoldAt(page: Page, seconds: number, { expectPr = true }: { expectPr?: boolean } = {}) {
  const setRows = page.getByText(/^Set \d+$/);
  const rowsBefore = await setRows.count();

  await setHoldSeconds(page, seconds);
  await page.getByRole('button', { name: 'Log set' }).click();

  if (expectPr) {
    const celebration = page.getByText('New PR!');
    await expect(celebration).toBeVisible();
    await celebration.click({ force: true });
    await expect(celebration).toBeHidden();
  }

  await expect(setRows).toHaveCount(rowsBefore + 1);
}

// Creates a household exercise measured in TIME rather than reps, via the same
// "+ Add your own exercise" flow as addOwnExercise plus the Reps/Time toggle.
export async function addOwnTimedExercise(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add your own exercise' }).click();
  await page.getByPlaceholder('Exercise name').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Time', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();
}
