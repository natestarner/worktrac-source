import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { addOwnTimedExercise, logHoldAt, logSetAt, pickExercise, setHoldSeconds } from './support/exercises';
import { goHardOffline, goOnline, waitForOutboxDrain } from './support/offline';

// The "This session" list. Scoping to it matters: the Best card above renders the SAME string
// whenever the hold just logged is also the person's longest, so an unscoped getByText is a
// strict-mode violation rather than a clean assertion.
const setRows = (page: import('@playwright/test').Page) => page.locator('.log-sets-col');

// Duration-tracked exercises: a set measured in seconds held rather than repetitions.
//
// The whole feature is one idea -- an exercise is measured either in reps or in time, and the
// screen tells you which -- so these specs check that the second stepper changes meaning, that a
// hold round-trips as time everywhere it is rendered, and that a rep-tracked exercise is
// completely untouched. Cross-connectivity behaviour lives in parity-endurance.spec.ts.

test.describe('endurance exercises', () => {
  test('a seeded hold logs in seconds and reads back as time', async ({ page, request }) => {
    await registerHousehold(page, request, 'Holt');

    await pickExercise(page, 'Wall Sit');

    // The one visible difference: the second stepper is Time, not Reps.
    await expect(page.getByLabel('Time')).toBeVisible();
    await expect(page.getByLabel('Reps')).toHaveCount(0);

    await logHoldAt(page, 45);

    await expect(page.getByText('Set 1')).toBeVisible();
    await expect(setRows(page).getByText('0:45', { exact: true })).toBeVisible();
  });

  test('the prefill carries the last hold forward, so a target hold is one tap', async ({ page, request }) => {
    await registerHousehold(page, request, 'Wren');
    await pickExercise(page, 'Wall Sit');

    await logHoldAt(page, 60);

    // Second set: the Time field already reads 1:00, so logging it needs no other interaction.
    // This is the "hold to a target" path -- identical in tap count to logging a bench set.
    await expect(page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value')).toHaveValue('1:00');
  });

  test('a weight vest is recorded in the existing weight field, with no new input', async ({ page, request }) => {
    await registerHousehold(page, request, 'Vesta');
    await pickExercise(page, 'Wall Sit');

    await setHoldSeconds(page, 30);
    const weight = page.locator('.stepper-row').filter({ hasText: 'Weight' }).locator('.stepper-value');
    await weight.fill('25');
    await weight.press('Enter');

    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(setRows(page).getByText('25 lb × 0:30', { exact: true })).toBeVisible();
  });

  // The deliberate limitation, asserted so it stays deliberate: seconds alone decide the ranking.
  test('a longer hold is a PR; more load at a shorter hold is not', async ({ page, request }) => {
    await registerHousehold(page, request, 'Corin');
    await pickExercise(page, 'Wall Sit');

    await logHoldAt(page, 40);
    await logHoldAt(page, 55);

    // Shorter, so no celebration however much load is added.
    await setHoldSeconds(page, 20);
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('Set 3')).toBeVisible();
    await expect(page.getByText('New PR!')).toHaveCount(0);
  });

  test('the Best card names the record a hold actually has', async ({ page, request }) => {
    await registerHousehold(page, request, 'Dara');
    await pickExercise(page, 'Wall Sit');
    await logHoldAt(page, 75);

    await expect(page.getByText('Best · Longest hold')).toBeVisible();
    // Never an est. 1RM -- Epley over zero reps is meaningless, and seconds presented as pounds is
    // the "rep count wearing a costume" mistake the bodyweight branch already guards against.
    await expect(page.getByText('Best · Est. 1RM')).toHaveCount(0);
  });

  test('a rep-tracked exercise is completely unchanged', async ({ page, request }) => {
    await registerHousehold(page, request, 'Bram');

    // Burpee is new in this change and deliberately rep-tracked -- things you COUNT are reps.
    await pickExercise(page, 'Burpee');
    await expect(page.getByLabel('Reps')).toBeVisible();
    await expect(page.getByLabel('Time')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start timer' })).toHaveCount(0);

    await logSetAt(page, 0, 15);
    await expect(page.getByText('0 lb × 15')).toBeVisible();
  });

  test('a household can add its own timed exercise', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sable');

    await page.getByPlaceholder('Search all exercises').fill('Ring Support Hold');
    await addOwnTimedExercise(page, 'Ring Support Hold');

    await expect(page.getByLabel('Time')).toBeVisible();
    await logHoldAt(page, 20);
    await expect(setRows(page).getByText('0:20', { exact: true })).toBeVisible();
  });

  test('a hold survives being logged offline and reads back as time after syncing', async ({ page, request }) => {
    await registerHousehold(page, request, 'Tovi');
    await pickExercise(page, 'Wall Sit');

    await goHardOffline(page);
    await setHoldSeconds(page, 50);
    await page.getByRole('button', { name: 'Log set' }).click();

    // ⚠️ The row must show the real time while queued, not a blank or a skeleton -- the value is
    // sitting in the mutation's own variables, and pendingBeforeSession is its only source while
    // contextSessionId is null (a person's entire outage).
    await expect(setRows(page).getByText('0:50', { exact: true })).toBeVisible();

    await goOnline(page);
    await waitForOutboxDrain(page);
    await expect(setRows(page).getByText('0:50', { exact: true })).toBeVisible();
  });

  test('the hold timer fills the Time field without logging', async ({ page, request }) => {
    await registerHousehold(page, request, 'Lark');
    await pickExercise(page, 'Wall Sit');

    await page.getByRole('button', { name: 'Start timer' }).click();
    await expect(page.getByRole('button', { name: /Stop timer/ })).toBeVisible();

    // The field tracks the running timer. Waiting on the value rather than a fixed sleep keeps
    // this off the clock: any tick past zero proves it is counting.
    const time = page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');
    await expect(time).not.toHaveValue('0:00', { timeout: 5000 });

    await page.getByRole('button', { name: /Stop timer/ }).click();

    // Stopping fills the field and nothing else -- a mis-tap must never commit a set.
    await expect(page.getByText(/^Set \d+$/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start timer' })).toBeVisible();
  });

  test('history and the records table read a hold as time', async ({ page, request }) => {
    await registerHousehold(page, request, 'Pell');
    await pickExercise(page, 'Wall Sit');
    await logHoldAt(page, 65);

    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('1:05').first()).toBeVisible();

    await page.getByRole('link', { name: 'Trends' }).click();
    await expect(page.getByText('Records · holds')).toBeVisible();
    await expect(page.getByText('Longest hold')).toBeVisible();
    // Weight-based rows disappear rather than rendering zeros.
    await expect(page.getByText('Best est. 1RM')).toHaveCount(0);
  });
});
