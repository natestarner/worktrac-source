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

// Weight/reps are steppers, not inputs. Tapping the value opens NumericKeypad, which is the only
// practical way to reach an exact number (135 lb is 18 stepper clicks). Wrapped in expect.poll
// because ExerciseDetail's computePrefillDraft effect re-seeds the draft when the summary /
// session-sets queries settle, which can land after the keypad closes and stomp the value --
// the same race offline-reads.spec.ts's setWeight documents.
export async function setStepper(page: Page, label: 'Weight' | 'Reps', target: number) {
  const row = page.locator('.stepper-row').filter({ hasText: label });
  const value = row.locator('.stepper-value');

  await expect
    .poll(
      async () => {
        if (Number(await value.textContent()) === target) return target;
        await value.click();
        const keypad = page.getByRole('dialog');
        for (let i = 0; i < 8; i += 1) {
          await keypad.getByRole('button', { name: '⌫', exact: true }).click();
        }
        for (const digit of String(target)) {
          await keypad.getByRole('button', { name: digit, exact: true }).click();
        }
        await keypad.getByRole('button', { name: 'Done', exact: true }).click();
        return Number(await value.textContent());
      },
      { timeout: 20000 },
    )
    .toBe(target);
}

function stepperValue(page: Page, label: 'Weight' | 'Reps') {
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
        if (Number(await stepperValue(page, 'Weight').textContent()) !== weight) {
          await setStepper(page, 'Weight', weight);
        }
        if (Number(await stepperValue(page, 'Reps').textContent()) !== reps) {
          await setStepper(page, 'Reps', reps);
        }
        const w = await stepperValue(page, 'Weight').textContent();
        const r = await stepperValue(page, 'Reps').textContent();
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
