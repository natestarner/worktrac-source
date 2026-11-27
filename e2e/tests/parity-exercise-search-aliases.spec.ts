import { Page, expect } from '@playwright/test';
import { logSetButton, closeSearch, searchFor, searchTrigger } from './support/exercises';
import { registerHousehold } from './support/auth';
import { forEachConnectivityMode } from './support/parity';

// PARITY: the exercise search finds a library exercise by another name ("OHP") and by the muscle
// it mainly works ("hamstrings"), and says which, from the cached catalog -- so it is the same
// with no signal. Aliases arrive with the catalog (V95/V96), like the muscles.

async function warmCatalog(page: Page) {
  await searchFor(page, 'Barbell Overhead Press');
  await expect(page.getByRole('button', { name: 'Barbell Overhead Press', exact: true })).toBeVisible();
  await closeSearch(page);
}

forEachConnectivityMode<void>('the exercise search finds other names and muscles in any mode', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Youghal');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await page.getByRole('link', { name: 'Log', exact: true }).click();
    await expect(searchTrigger(page)).toBeVisible();
  },
  act: async (page) => {
    await searchFor(page, 'ohp');
  },
  assert: async (page) => {
    const result = page.getByRole('button', { name: 'Barbell Overhead Press', exact: true });
    await expect(result).toBeVisible();
    await expect(result).toContainText('Also called OHP');

    await searchFor(page, 'hamstrings');
    const rdl = page.getByRole('button', { name: 'Romanian Deadlift', exact: true });
    await expect(rdl).toBeVisible();
    await expect(rdl).toContainText('Works Hamstrings');

    // Picking a result found by its other name opens the exercise itself.
    await searchFor(page, 'ohp');
    await result.click();
    await expect(logSetButton(page)).toBeVisible();
    await expect(page.getByText('Barbell Overhead Press', { exact: true }).first()).toBeVisible();
  },
});
