import { Page, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { backToPicker, pickExercise } from './support/exercises';
import { turnOnMuscleHighlighter } from './support/muscleMap';
import { forEachConnectivityMode } from './support/parity';

// PARITY spec: the exercise's "About" strip and sheet -- muscles worked, drawn on a body -- across
// online / lie-fi / hard-offline / pinned-offline from one assertion body.
//
// Nothing in this flow should touch the network: the muscles arrive with the exercise catalog
// (cached for offline use), the body art is a build asset, and the body choice is per-person local
// state -- male until the person switches. So every mode must show the same muscles on the same body. If an assertion here ever
// needs to branch on ctx.mode, that is a divergence for resilience.md's register, not an `if`.
//
// What this does NOT cover: the body IMAGE loading with no network. Under the dev server a body
// image never requested before cannot load hard-offline, while production precaches it (the
// service worker, vite.config.js) and the App Store app ships it -- offline-durability.spec.ts is
// where the service-worker half belongs. Here we assert the diagram's own structure: which
// outlines are shaded, and how strongly.

const EXERCISE = 'Barbell Bench Press';
const ABOUT = 'About this exercise: works Chest, helped by Shoulders and Triceps';
const OTHER_EXERCISE = 'Barbell Back Squat';
const OTHER_ABOUT = /^About this exercise: works /;

async function warmCatalog(page: Page) {
  const search = page.getByPlaceholder('Search all exercises');
  await search.fill(EXERCISE);
  await expect(page.getByRole('button', { name: EXERCISE, exact: true })).toBeVisible();
  await search.fill('');
}

// The library sets a shaded outline's strength as its inline opacity: 0.8 for a main muscle, 0.35
// for a helper, nothing for the rest. Its outline ids name the body: `pectoralis` on the male
// art, `pectoralis_female` on the female.
async function shading(page: Page, body: string, muscleId: string) {
  return page
    .getByRole('img', { name: body })
    .locator(`.mm-muscle-layer path[data-muscle-id="${muscleId}"]`)
    .first()
    .evaluate((el) => (el as SVGElement).style.opacity)
    .catch(() => null);
}

forEachConnectivityMode<void>('the About sheet shows the muscles worked on the chosen body', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Tralee');
    // Off by default (V102); this spec is about the diagram. Off is muscle-highlighter-setting.spec.ts.
    await turnOnMuscleHighlighter(page);
    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await page.getByRole('button', { name: ABOUT }).click();
    // Nothing chosen yet: the male body is drawn at once, with no question first.
    await expect(page.getByRole('button', { name: 'Show a male body' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => shading(page, 'Front of the body', 'pectoralis')).toBe('0.8');
    await page.getByRole('button', { name: 'Show a female body' }).click();
  },
  assert: async (page) => {
    const sheet = page.getByRole('dialog', { name: EXERCISE });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Show a female body' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByText('Primary muscles')).toBeVisible();
    await expect(sheet.getByText('Chest', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Triceps', { exact: true })).toBeVisible();

    // The female body's outlines carry a _female suffix in the art's registry, so this also
    // proves the choice reached the diagram, not just the switch.
    await expect.poll(() => shading(page, 'Front of the body', 'pectoralis_female')).toBe('0.8');
    await expect.poll(() => shading(page, 'Back of the body', 'triceps_female')).toBe('0.35');

    // Closed here, not later: leaving pinned-offline goes through the offline banner, which the
    // sheet's scrim would cover.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  },
  afterReconnect: async (page) => {
    // The choice is the person's and outlives the sheet: reopening draws the same body.
    await page.getByRole('button', { name: ABOUT }).click();
    await expect(page.getByRole('button', { name: 'Show a female body' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // ...and it is not per exercise: another exercise opens on the same body.
    await backToPicker(page);
    await pickExercise(page, OTHER_EXERCISE);
    await page.getByRole('button', { name: OTHER_ABOUT }).click();
    await expect(page.getByRole('dialog', { name: OTHER_EXERCISE })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show a female body' })).toHaveAttribute('aria-pressed', 'true');
    // Leave the screen as found: the harness ends by opening History from the tab bar, which a
    // sheet's scrim would cover.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  },
});
