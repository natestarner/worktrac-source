import { Locator, Page, expect, test } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnExercise } from './support/exercises';
import { goHardOffline, goOnline, waitForOutboxDrain } from './support/offline';

// Changing your own exercise's muscles in "Customize this exercise", then closing the modal
// WITHOUT pressing "Update muscles": closing saves the edit. Picking muscles and leaving reads as
// done, and the modal's other fields already save themselves on blur.
//
// Muscles are a gated (online-only) write. Offline the picker is disabled, so the only gap is signal
// dropping between the edit and the close: the modal still closes, and the gate's toast says why
// nothing saved -- never closing as if it had.
//
// Each test asks the SERVER, because the strip reads the cached catalog either way.

async function serverMusclesOf(page: Page, name: string) {
  return page.evaluate(async (exerciseName) => {
    const { apiUrl } = await (await fetch('/config.json')).json();
    const token = localStorage.getItem('workout-tracker-token');
    const rows = await (await fetch(`${apiUrl}/api/exercises`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const row = rows.find((r: { name: string }) => r.name === exerciseName);
    return row ? { primary: row.primaryMuscles, secondary: row.secondaryMuscles } : null;
  }, name);
}

// Names share no movement word with the library, so nothing is suggested on create.
async function openCustomizeOnOwnExercise(page: Page, request: Parameters<typeof registerHousehold>[1], name: string) {
  await registerHousehold(page, request, 'Pim');
  await addOwnExercise(page, name);
  await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();
  // The muscles write needs the exercise's real id, so let the create reach the server first.
  await waitForOutboxDrain(page);
  await page.getByRole('button', { name: 'Customize this exercise' }).click();
  return page.getByRole('dialog');
}

// The picker groups muscles by body area, all closed at first. `exact`: Playwright's name match is a
// substring, and "Core" must not catch a chip whose name merely contains it.
async function addObliques(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Core', exact: true }).click();
  await dialog.getByRole('button', { name: 'Obliques: not worked' }).click();
}

for (const exit of ['Done', 'Close'] as const) {
  test(`closing with ${exit === 'Close' ? 'the X' : 'Done'} saves muscles nobody pressed "Update muscles" for`, async ({
    page,
    request,
  }) => {
    const name = `Blorvik Heave ${exit}`;
    const dialog = await openCustomizeOnOwnExercise(page, request, name);

    await addObliques(dialog);
    await expect(dialog.getByRole('button', { name: 'Update muscles' })).toBeVisible();
    await dialog.getByRole('button', { name: exit, exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => serverMusclesOf(page, name)).toEqual({ primary: ['obliques'], secondary: [] });
    await expect(page.getByRole('button', { name: /About this exercise: works Obliques/ })).toBeVisible();
  });
}

test('signal dropping after the edit: closing still closes, and says it needs a connection', async ({ page, request }) => {
  const name = 'Blorvik Heave Offline';
  const dialog = await openCustomizeOnOwnExercise(page, request, name);

  await addObliques(dialog);
  await goHardOffline(page);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Editing needs a connection.', { exact: true })).toBeVisible();

  await goOnline(page);
  await expect.poll(() => serverMusclesOf(page, name)).toEqual({ primary: [], secondary: [] });
});
