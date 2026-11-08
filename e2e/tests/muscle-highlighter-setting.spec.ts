import { Page, expect, test } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { logSetAt, pickExercise } from './support/exercises';
import { waitForOutboxDrain } from './support/offline';
import { forEachConnectivityMode } from './support/parity';

// The muscle highlighter -- the shaded body diagrams -- is an account-wide setting, OFF by default
// (V102). Off, every place that would draw a body shows a note linking to Settings instead; the
// muscle names stay. The owner turns it on from Settings.

const EXERCISE = 'Barbell Bench Press';
const ABOUT = 'About this exercise: works Chest, helped by Shoulders and Triceps';
const NOTE = 'The muscle highlighter is off by default. To turn it on, visit the Settings page.';

async function warmCatalog(page: Page) {
  const search = page.getByPlaceholder('Search all exercises');
  await search.fill(EXERCISE);
  await expect(page.getByRole('button', { name: EXERCISE, exact: true })).toBeVisible();
  await search.fill('');
}

async function openAbout(page: Page) {
  await page.getByRole('button', { name: ABOUT }).click();
}

async function expectAboutSheetOff(page: Page) {
  const sheet = page.getByRole('dialog', { name: EXERCISE });
  await expect(sheet.getByTestId('muscle-map-off')).toHaveText(NOTE);
  await expect(sheet.getByRole('link', { name: 'Settings page' })).toBeVisible();
  await expect(sheet.getByRole('img', { name: 'Front of the body' })).toHaveCount(0);
  await expect(sheet.getByRole('group', { name: 'Body diagram' })).toHaveCount(0);
  await expect(sheet.getByText('Chest', { exact: true })).toBeVisible();
  // Closed before the harness moves on: a sheet's scrim covers the offline banner and the tab bar.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

// The setting is read from the auth snapshot, so the note is the same in every mode -- including a
// device that cannot reach the server to ask.
forEachConnectivityMode<void>('with the muscle highlighter off, the About sheet says so and links to Settings', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Kinsale');
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await openAbout(page);
  },
  assert: async (page) => {
    await expectAboutSheetOff(page);
  },
  afterReconnect: async (page) => {
    await openAbout(page);
    await expectAboutSheetOff(page);
  },
});

test('the owner turns the muscle highlighter on from the note, and the bodies appear everywhere', async ({ page, request }) => {
  await registerHousehold(page, request, 'Dingle');
  await pickExercise(page, EXERCISE);
  await logSetAt(page, 135, 5);
  await waitForOutboxDrain(page);

  // Trends: the note stands where the bodies would be, and the list of sets stays.
  await page.getByRole('link', { name: 'Trends' }).click();
  const card = page.getByTestId('muscle-map');
  await expect(card.getByTestId('muscle-map-off')).toHaveText(NOTE);
  await expect(card.getByRole('img', { name: /of the body/ })).toHaveCount(0);
  await expect(card.getByRole('list', { name: 'Sets per muscle' })).toBeVisible();

  // The note's link goes to Settings, where the switch is Off.
  await card.getByRole('link', { name: 'Settings page' }).click();
  await expect(page).toHaveURL(/\/app\/settings/);
  await expect(page.getByText(/off by default so each household can decide/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Muscle highlighter Off' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Muscle highlighter On' }).click();
  await expect(page.getByRole('button', { name: 'Muscle highlighter On' })).toHaveAttribute('aria-pressed', 'true');

  // Back to Trends: the bodies are drawn.
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page).toHaveURL(/\/app\/trends/);
  await expect(card.getByRole('img', { name: 'Front of the body, shaded by sets per muscle' })).toBeVisible();
  await expect(card.getByTestId('muscle-map-off')).toHaveCount(0);

  // And on Log: the About sheet now asks which body to draw.
  await page.getByRole('link', { name: 'Log', exact: true }).click();
  await openAbout(page);
  await expect(page.getByText('Which body should the muscle diagram show?')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  // It is the account's setting, kept on the server: still on after a reload.
  await page.goto('/app/settings');
  await expect(page.getByRole('button', { name: 'Muscle highlighter On' })).toHaveAttribute('aria-pressed', 'true');
});
