import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { addPerson } from './support/people';

// How far one tap of the Log screen's +/- moves the weight and the time is a per-person preference,
// configured for every person together in Settings -- the same shape as the rest timer, and for the
// same reason (a household member training at 2.5 lb jumps and one training at 10 lb are both
// right). It is persisted server-side, not per device, which is what the reload below proves.
//
// The defaults are the numbers these steps were hardcoded to before they became a preference, so an
// account that never opens this screen behaves exactly as it did.
async function openAppSettings(page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'App Settings' }).click();
  await expect(page.getByText('Steppers')).toBeVisible();
}

// Clicks a pill and waits for the write to actually land before returning. The pill is
// `disabled={busy || !online}` for the length of the request (AppSettingsTab.jsx), so waiting for
// it to become enabled again is a real signal the gated write settled -- not a fixed pause.
//
// Against local loopback this never mattered: the round trip was fast enough that the very next
// navigation always landed after refreshPeople() had already resolved. Against a real network
// (lower) it does not resolve in time, and a caller that clicks then immediately navigates away
// reads back the PRE-write value -- discovered as lower's own e2e-tests job failing 3/3 while the
// local suite passed 6/6 (both runs against the same commit).
async function setStepperPill(page, name) {
  const pill = page.getByRole('button', { name });
  await pill.click();
  await expect(pill).toBeEnabled();
}

const weightValue = (page) =>
  page.locator('.stepper-row').filter({ hasText: 'Weight' }).locator('.stepper-value');
const timeValue = (page) =>
  page.locator('.stepper-row').filter({ hasText: 'Time' }).locator('.stepper-value');

test.describe('Stepper increments', () => {
  test('the weight step defaults to 2.5 and follows what Settings is set to', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sloane');
    await pickExercise(page, 'Barbell Bench Press');

    // A brand-new exercise has no prefill, so the draft starts blank and logs as 0.
    await page.getByTitle('Increase Weight (lb)').click();
    await expect(weightValue(page)).toHaveValue('2.5');

    await openAppSettings(page);
    await setStepperPill(page, 'Weight step 10 lb for Sloane');
    await page.getByRole('button', { name: /Back/ }).click();

    await expect(weightValue(page)).toHaveValue('2.5');
    await page.getByTitle('Increase Weight (lb)').click();
    await expect(weightValue(page)).toHaveValue('12.5');
  });

  test('the choice is stored account-side, not on the device', async ({ page, request }) => {
    await registerHousehold(page, request, 'Marlowe');

    await openAppSettings(page);
    await setStepperPill(page, 'Time step 30s for Marlowe');

    // A reload throws away every in-memory copy; the value has to come back from the server.
    // It reloads onto Settings, which is where we were, so step back out to the Log tab.
    await page.reload();
    await page.getByRole('button', { name: /Back/ }).click();

    await pickExercise(page, 'Wall Sit');
    await expect(timeValue(page)).toHaveValue('0:30');
    await page.getByTitle('Increase Time').click();
    await expect(timeValue(page)).toHaveValue('1:00');
  });

  test('one person’s step does not become everybody’s', async ({ page, request }) => {
    await registerHousehold(page, request, 'Odessa');

    // A second person, so there are two rows to tell apart.
    await addPerson(page, 'Rune');

    await openAppSettings(page);
    await setStepperPill(page, 'Weight step 10 lb for Odessa');
    await page.getByRole('button', { name: /Back/ }).click();

    // Both people get their own controls, on the one screen. Which one is SELECTED is not
    // asserted here -- the pills carry no pressed state -- so the proof is what each person's
    // stepper actually does below.
    await openAppSettings(page);
    await expect(page.getByRole('button', { name: 'Weight step 10 lb for Odessa' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Weight step 2.5 lb for Rune' })).toBeVisible();
    await page.getByRole('button', { name: /Back/ }).click();

    // Explicit rather than assumed: adding a person must not silently decide who is active.
    await page.locator('.person-pill-bar').getByRole('button', { name: 'Odessa', exact: true }).click();
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByTitle('Increase Weight (lb)').click();
    await expect(weightValue(page)).toHaveValue('10');

    await page.locator('.person-pill-bar').getByRole('button', { name: 'Rune', exact: true }).click();
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByTitle('Increase Weight (lb)').click();
    await expect(weightValue(page)).toHaveValue('2.5');
  });
});
