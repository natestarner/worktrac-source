import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Profile's People list (frontend/src/components/profile/PeopleSection.jsx): one row per person,
 * with how they sign in and what they may do, and a sheet behind each row for changing any of it.
 *
 * ⚠️ Always scope to the list. PersonPillBar renders every person's name as its own button once a
 * household has 2+ people, so an unscoped getByText('Sam') is ambiguous the instant both mount.
 */
export function peopleList(page: Page): Locator {
  return page.getByTestId('people-list');
}

/** Each row's at-a-glance login line: "Signs in as …" for everyone holding a login. */
export function signedInRows(page: Page): Locator {
  return peopleList(page).getByText(/^Signs in as /);
}

/**
 * A tag on the rows (Owner, Trusted, Invited, Locked, …), matched whole.
 *
 * By the tag's class, not by text alone: the list's intro says "Make someone **Trusted**…", whose
 * bold word is an exact text match too.
 */
export function personTag(page: Page, label: string): Locator {
  return peopleList(page).locator('.person-tag').filter({ hasText: new RegExp(`^${label}$`) });
}

/** Opens one person's sheet from their row and returns it. */
export async function openPersonSheet(page: Page, name: string): Promise<Locator> {
  await peopleList(page).getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  const sheet = page.getByRole('dialog', { name, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Closes whichever sheet is open, by its own X. */
export async function closePersonSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
}
