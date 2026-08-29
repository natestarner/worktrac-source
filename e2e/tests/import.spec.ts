import { expect, test } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { pickExercise, logSetAt } from './support/exercises';

// Import through the real UI: pick a person, pick a file, confirm what it says, and check the data
// landed where it was supposed to and nowhere else.
//
// Files are supplied in-memory rather than from a fixtures directory. The suite has no fixture
// convention, and a spec that carries its own CSV inline says what it is testing without a second
// file to open.

// Importing is a Pro feature. Every case in this file is about the import itself rather than
// about billing, so the plan is stated once here instead of being an assumption each spec would
// silently depend on. setBillingPlan writes the same `comped` flag a founding household uses, so
// these still run through the real entitlement derivation.
async function registerAsPro(page, request, name: string) {
  const email = await registerHousehold(page, request, name);
  await setBillingPlan(request, email, 'PRO');
  await page.reload();
  return email;
}

async function openImportModal(page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'App Settings' }).click();
  await page.getByRole('button', { name: 'Import data' }).click();
}

function personPill(page, name: string) {
  return page.locator('.person-pill-bar').getByRole('button', { name: new RegExp(name) });
}

async function chooseCsv(page, name: string, csv: string) {
  await page.getByLabel('Choose a file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf-8'),
  });
}

// Same flow multi-person.spec.ts uses. The new person becomes active, which is why the caller
// switches back afterwards.
async function addPerson(page, name: string) {
  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();
}

test.describe('CSV import', () => {
  test('a person\'s export imports into a different person, and leaves the first alone', async ({ page, request }) => {
    await registerAsPro(page, request, 'Casey');

    await pickExercise(page, 'Barbell Bench Press');
    await logSetAt(page, 135, 8);
    // logSetAt already waits for the Set row, so the celebration may or may not still be up by
    // now. Dismiss it only if it is, rather than waiting on a transient.
    const celebration = page.getByText('New PR!');
    if (await celebration.isVisible().catch(() => false)) {
      await celebration.click({ force: true });
    }

    // Export Casey's data through the same button a person would use.
    await page.getByRole('link', { name: 'History' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const csv = (await new Response(stream as never).text()).toString();
    expect(csv).toContain('Barbell Bench Press');

    await addPerson(page, 'Jordan');

    await openImportModal(page);
    await page.getByLabel('Import into').selectOption({ label: 'Jordan' });
    await chooseCsv(page, 'casey.csv', csv);

    await expect(page.getByText(/will be added to Jordan’s history/)).toBeVisible();
    await page.getByRole('button', { name: /^Import 1 set into Jordan/ }).click();
    await expect(page.getByText('Import complete')).toBeVisible();

    // Jordan has it...
    await page.getByRole('button', { name: 'View Jordan’s history' }).click();
    await expect(page.getByRole('button', { name: 'Show only Barbell Bench Press in history' })).toBeVisible();

    // ...and Casey still has exactly the one set they logged, not two.
    await personPill(page, 'Casey').click();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('button', { name: 'Show only Barbell Bench Press in history' })).toHaveCount(1);
  });

  // The same-day rule as a test result rather than a comment: a hand-built file with no Session
  // Start column groups one workout per date.
  test('a hand-built file with no Session Start becomes one workout per day', async ({ page, request }) => {
    await registerAsPro(page, request, 'Casey');

    await openImportModal(page);
    await chooseCsv(
      page,
      'spreadsheet.csv',
      ['Exercise,Date,Reps', 'Pull-up,2026-08-20,8', 'Pull-up,2026-08-20,6', 'Pull-up,2026-08-21,5'].join('\n'),
    );

    await expect(page.getByText(/2 workouts will be added|across 2 workouts/)).toBeVisible();
    // The contract is stated up front, and the defaults it applied are reported before committing.
    await expect(page.getByText(/one workout per day/)).toBeVisible();
    await expect(page.getByText(/imported as bodyweight/)).toBeVisible();

    await page.getByRole('button', { name: /^Import 3 sets into Casey/ }).click();
    await expect(page.getByText('Import complete')).toBeVisible();
    await page.getByRole('button', { name: 'View Casey’s history' }).click();

    await expect(page.getByRole('button', { name: 'Show only Pull-up in history' })).toHaveCount(2);
  });

  test('an import can be undone from Settings, and History goes back to what it was', async ({ page, request }) => {
    await registerAsPro(page, request, 'Casey');

    await openImportModal(page);
    await chooseCsv(page, 'undo-me.csv', ['Exercise,Date,Reps', 'Pull-up,2026-08-20,8'].join('\n'));
    await page.getByRole('button', { name: /^Import 1 set into Casey/ }).click();
    await expect(page.getByText('Import complete')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByText('undo-me.csv')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('No workouts logged yet for Casey.')).toBeVisible();
  });

  // Re-importing the same file must be a no-op, and must SAY it is one rather than offering a
  // button that would do nothing.
  test('re-importing the same file offers nothing to do', async ({ page, request }) => {
    await registerAsPro(page, request, 'Casey');
    const csv = ['Exercise,Date,Reps', 'Pull-up,2026-08-20,8'].join('\n');

    await openImportModal(page);
    await chooseCsv(page, 'twice.csv', csv);
    await page.getByRole('button', { name: /^Import 1 set into Casey/ }).click();
    await expect(page.getByText('Import complete')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: 'Import data' }).click();
    await chooseCsv(page, 'twice.csv', csv);

    await expect(page.getByText(/Nothing to import/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  });

  test('the entry point refuses offline, in the offline-gating idiom', async ({ page, request, context }) => {
    await registerAsPro(page, request, 'Casey');
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'App Settings' }).click();

    await context.setOffline(true);

    const importButton = page.getByRole('button', { name: 'Import data' });
    await expect(importButton).toBeDisabled();
    await expect(importButton).toHaveAttribute('title', /needs a connection/i);

    await context.setOffline(false);
  });
});
