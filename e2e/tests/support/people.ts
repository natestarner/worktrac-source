import { Page, expect } from '@playwright/test';

// Adds a person through the real UI. The modal's field is placeholder "Name" and its confirm
// button is scoped to the dialog, because "Add" alone also matches controls behind it.
//
// ⚠️ Waits for the new person's PILL, not for the exercise picker. Several spec-local copies of
// this wait on "Search all exercises" instead, which is already on screen for the CURRENT person --
// so that wait can be satisfied before the modal has even closed. That is harmless where the next
// step is slow anyway, and immediately fatal where the next call asks the SERVER for this person by
// name: it showed up as an intermittent 404 that moved between tests on every run.
//
// ⚠️ This is the canonical copy. Six spec files still carry their own, predating this module --
// extracting them is a cleanup of its own, not something to fold into an unrelated feature commit.
// Do not add a seventh: import this one.
export async function addPerson(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
}
