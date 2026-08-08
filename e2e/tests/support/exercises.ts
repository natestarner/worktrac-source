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

// Logs one set at an exact weight/reps. Every caller so far logs strictly increasing bests, so the
// PR celebration fires each time and must be dismissed before the next set can be logged.
export async function logSetAt(page: Page, weight: number, reps: number) {
  await setStepper(page, 'Weight', weight);
  await setStepper(page, 'Reps', reps);
  await page.getByRole('button', { name: 'Log set' }).click();

  const celebration = page.getByText('New PR!');
  await expect(celebration).toBeVisible();
  await celebration.click({ force: true });
  await expect(celebration).toBeHidden();
}
