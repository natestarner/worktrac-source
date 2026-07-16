import { Page } from '@playwright/test';

// After the favorites redesign, a newly-registered person's Log picker is empty (it only shows
// their favorites and previously-logged exercises). Selecting an exercise for the first time
// means searching the catalog, then tapping the result chip. Works whether or not the exercise
// is already in the person's list.
export async function pickExercise(page: Page, name: string) {
  await page.getByPlaceholder('Search all exercises').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

// The routine builder's "Add exercise to routine" pool likewise defaults to favorites/logged,
// so search the catalog, then tap the "+ Name" chip.
export async function addExerciseToRoutine(page: Page, name: string) {
  await page.getByPlaceholder('Search all exercises').fill(name);
  await page.getByRole('button', { name: `+ ${name}`, exact: true }).click();
}

// Create a custom exercise via the always-present "+ Add your own exercise" button (on the Log
// picker or the routine modal). Creating it auto-favorites it and opens its detail screen.
export async function addOwnExercise(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add your own exercise' }).click();
  await page.getByPlaceholder('Exercise name').fill(name);
  // The modal has a setup-field "Add" chip button and the submit "Add" button; submit is last.
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).last().click();
}
