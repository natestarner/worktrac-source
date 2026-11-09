import { Page, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { forEachConnectivityMode } from './support/parity';

// PARITY spec: adding your own exercise WITH its muscles, across online / lie-fi / hard-offline /
// pinned-offline. Creating an exercise is a durable write, so it must work the same in every mode,
// and the muscles must ride along: on the temp row (so the strip shows them before the create
// syncs -- for a whole outage when offline) and in the queued create (so the server stores them).
//
// `assert` checks what the person sees; `afterReconnect` asks the SERVER, because the strip would
// read the same from the temp row whether or not the muscles ever reached the backend.

const EXERCISE = 'Qwerty Zorp'; // shares no movement word with the library, so nothing is suggested
const ABOUT = 'About this exercise: works Obliques, helped by Abs';

async function serverMusclesOf(page: Page, name: string) {
  return page.evaluate(async (exerciseName) => {
    const { apiUrl } = await (await fetch('/config.json')).json();
    const token = localStorage.getItem('workout-tracker-token');
    const rows = await (await fetch(`${apiUrl}/api/exercises`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const row = rows.find((r: { name: string }) => r.name === exerciseName);
    return row ? { primary: row.primaryMuscles, secondary: row.secondaryMuscles } : null;
  }, name);
}

forEachConnectivityMode<void>('your own exercise keeps the muscles you picked', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Dingle');
  },
  act: async (page) => {
    await page.getByRole('button', { name: '+ Add your own exercise' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Exercise name').fill(EXERCISE);
    await dialog.getByRole('button', { name: 'Core', exact: true }).click(); // the body areas start closed
    await dialog.getByRole('button', { name: 'Obliques: not worked' }).click();
    await dialog.getByRole('button', { name: 'Abs: not worked' }).click();
    await dialog.getByRole('button', { name: 'Abs: primary' }).click(); // primary -> secondary
    await dialog.getByRole('button', { name: 'Add', exact: true }).last().click();
  },
  assert: async (page) => {
    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();
    await expect(page.getByRole('button', { name: ABOUT })).toBeVisible();
  },
  afterReconnect: async (page) => {
    await expect.poll(() => serverMusclesOf(page, EXERCISE)).toEqual({ primary: ['obliques'], secondary: ['abs'] });
    // And the screen now reads the server's row, saying the same.
    await expect(page.getByRole('button', { name: ABOUT })).toBeVisible();
  },
});
