import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnExercise } from './support/exercises';

// A household's OWN exercise: "Measured in" on Add exercise (Weight & reps, the default; Bodyweight;
// Time) decides how its first set asks for a weight, and Customize switches Weight & reps <->
// Bodyweight later. The library half and every connectivity mode are parity-first-set-weight.spec.ts.

test.describe('your own exercise\'s load type', () => {
  test('defaults to Weight & reps: the first set asks for a weight', async ({ page, request }) => {
    await registerHousehold(page, request, 'Odile');
    await addOwnExercise(page, 'Hip Thrust Machine');

    await expect(page.getByRole('button', { name: 'Enter a weight' })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('');
  });

  test('chosen as Bodyweight, the first set starts at 0 under "Added"', async ({ page, request }) => {
    await registerHousehold(page, request, 'Odile');
    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    await page.getByPlaceholder('Exercise name').fill('Ring Dip');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Bodyweight', exact: true }).check();
    await dialog.getByRole('button', { name: 'Add', exact: true }).last().click();

    await expect(page.getByRole('textbox', { name: 'Added (lb)' })).toHaveValue('0');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeEnabled();
  });

  test('can be switched to Bodyweight later in Customize', async ({ page, request }) => {
    await registerHousehold(page, request, 'Odile');
    await addOwnExercise(page, 'Ring Row');
    await expect(page.getByRole('button', { name: 'Enter a weight' })).toBeDisabled();

    // Customize is enabled once the create has synced (it needs a real id).
    const customize = page.getByRole('button', { name: 'Customize this exercise' });
    await expect(customize).toBeEnabled();
    await customize.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: 'Weight & reps', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: 'Bodyweight', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Bodyweight', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByRole('textbox', { name: 'Added (lb)' })).toHaveValue('0');
    await expect(page.getByRole('button', { name: 'Log set' })).toBeEnabled();

    // It stuck on the SERVER, which is what every other device reads. Asked directly rather than by
    // reloading: the catalog cache is written to the device at most once a second, so a reload in
    // that window shows the copy from before (the same accepted gap as a muscles edit).
    const { apiUrl } = await (await page.request.get('/config.json')).json();
    const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
    await expect
      .poll(async () => {
        const rows = await (await page.request.get(`${apiUrl}/api/exercises`, {
          headers: { Authorization: `Bearer ${token}` },
        })).json();
        return rows.find((e: { name: string }) => e.name === 'Ring Row')?.loadType;
      })
      .toBe('bodyweight');
  });

  // iPhone SE width. "Measured in" was one segmented row whose three labels wrapped and ran together
  // at this size; now each choice is its own row. Asserted as STRUCTURE (three stacked boxes, none
  // overlapping, all inside the dialog), never as "this label fits" -- that depends on the font.
  // Muscles worked starts folded to one row, so the dialog opens short.
  test('at phone width, the three measures are separate rows and the muscles start folded', async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await registerHousehold(page, request, 'Odile');
    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    const dialog = page.getByRole('dialog');
    const group = dialog.getByRole('radiogroup', { name: 'Measured in' });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await expect(dialog.getByRole('radio', { name: 'Weight & reps', exact: true })).toBeChecked();

    const panel = await dialog.boundingBox();
    const rows = [];
    for (const name of ['Weight & reps', 'Bodyweight', 'Time']) {
      const box = await group.locator('label').filter({ has: page.getByRole('radio', { name, exact: true }) }).boundingBox();
      expect(box).not.toBeNull();
      rows.push(box!);
    }
    for (const [i, row] of rows.entries()) {
      expect(row.height).toBeGreaterThanOrEqual(44);
      expect(row.x).toBeGreaterThanOrEqual(panel!.x);
      expect(row.x + row.width).toBeLessThanOrEqual(panel!.x + panel!.width + 0.5);
      if (i > 0) expect(row.y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].height);
    }

    const muscles = dialog.getByRole('button', { name: 'Muscles worked', exact: true });
    await expect(muscles).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.getByRole('button', { name: 'Legs', exact: true })).toHaveCount(0);
    await muscles.click();
    // Opened, the picker is INSIDE the card that holds the row, so it reads as the row's contents
    // rather than as more of the form: its body areas fall within the card's box.
    const card = muscles.locator('xpath=..');
    const legs = card.getByRole('button', { name: 'Legs', exact: true });
    await expect(legs).toBeVisible();
    // A drawn card, not just a wrapper: the first cut's wrapper enclosed the picker too, unbordered,
    // and it read as loose form content.
    await expect(card).toHaveCSS('border-top-style', 'solid');
    await expect(card).not.toHaveCSS('border-top-width', '0px');
    const cardBox = (await card.boundingBox())!;
    const legsBox = (await legs.boundingBox())!;
    expect(legsBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(legsBox.x + legsBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
    expect(legsBox.y + legsBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 0.5);
  });
});
