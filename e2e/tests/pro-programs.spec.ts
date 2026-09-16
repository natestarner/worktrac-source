import { expect, test } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { addPerson } from './support/people';

// A program, end to end: a trainer writes the numbers on a routine, assigns it to a client, and the
// client's Log screen shows what they are meant to hit.
//
// RoutineControllerTest covers the copy and the provenance stamp at the API. What only a browser
// proves is the bit that makes the feature real -- that a target typed into the builder survives the
// round trip and renders on the screen somebody logs from.
test.describe('Pro — programs', () => {

  async function openRoutines(page) {
    await page.getByRole('link', { name: 'Routines' }).click();
  }

  // ⚠️ THE ASSERTION THE FEATURE EXISTS FOR. A template whose numbers do not travel arrives as a
  // bare list of exercise names, which is a checklist rather than a program.
  test('a target typed in the builder reaches the Log screen', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await page.reload();

    await openRoutines(page);
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Squat Day');
    await page.getByPlaceholder('Search all exercises').fill('Barbell Bench Press');
    await page.getByRole('button', { name: 'Barbell Bench Press', exact: true }).click();
    await page.getByLabel(/Target weight/).fill('185');
    await page.getByLabel(/Target reps/).fill('5');
    await page.getByRole('button', { name: 'Save routine' }).click();

    // Start the routine, which is how a person reaches the exercise with the program's context.
    await expect(page.getByText('Squat Day')).toBeVisible();
    await page.getByRole('button', { name: /Start/ }).first().click();

    await expect(page.getByText('Target')).toBeVisible();
    await expect(page.getByText('185 lb × 5')).toBeVisible();
  });

  // ⚠️ A PRESCRIPTION, NOT A PREFILL. The steppers must keep their own value: a prefill nobody
  // typed is the race that logged a 315 deadlift as 0 (docs/incidents/2026-08-12), and the app
  // arguing with the gym floor is the one thing a logging-first product must not do.
  test('does not prefill the steppers with the target', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await page.reload();

    await openRoutines(page);
    await page.getByRole('button', { name: '+ New routine' }).click();
    await page.getByPlaceholder('Routine name (e.g. Push Day)').fill('Heavy');
    await page.getByPlaceholder('Search all exercises').fill('Barbell Bench Press');
    await page.getByRole('button', { name: 'Barbell Bench Press', exact: true }).click();
    await page.getByLabel(/Target weight/).fill('225');
    await page.getByRole('button', { name: 'Save routine' }).click();
    await page.getByRole('button', { name: /Start/ }).first().click();

    await expect(page.getByText('225 lb')).toBeVisible();
    // The Weight STEPPER specifically -- the same locator setStepper uses. A bare
    // getByRole('spinbutton').first() also matches the target field itself while the builder is
    // still closing, which is an assertion about the wrong element.
    const weight = page.locator('.stepper-row').filter({ hasText: 'Weight' }).locator('.stepper-value');
    await expect(weight).not.toHaveValue('225');
  });

  // A routine built for somebody else is an assignment, and their list says who put it there.
  //
  // The copy itself is driven over the API rather than through its modal: CopyRoutineModal has its
  // own unit coverage, and what was actually MISSING here was the rendering -- RoutineDto has
  // carried assignedByName since programs shipped and nothing displayed it, so a client had a
  // program in their list with no idea who wrote it. Routines are marked refreshAfterRestore, so
  // the reload below genuinely refetches rather than reading a warmed cache.
  test('a routine assigned to a client says who assigned it', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await addPerson(page, 'Dana');

    const { apiUrl } = await (await request.get('/config.json')).json();
    const token = (await (await request.post(`${apiUrl}/api/auth/login`, {
      data: { email: ownerEmail, password: 'password123' },
    })).json()).token;
    const auth = { Authorization: `Bearer ${token}` };

    const people = await (await request.get(`${apiUrl}/api/people`, { headers: auth })).json();
    const nate = people.find((p) => p.name === 'Nate');
    const dana = people.find((p) => p.name === 'Dana');
    const exercises = await (await request.get(`${apiUrl}/api/exercises`, { headers: auth })).json();

    const routine = await (await request.post(`${apiUrl}/api/people/${nate.id}/routines`, {
      headers: auth,
      data: { name: 'Dana Week 1', exercises: [{ exerciseId: exercises[0].id, targetReps: 5 }] },
    })).json();

    await request.post(`${apiUrl}/api/people/${nate.id}/routines/${routine.id}/copy`, {
      headers: auth,
      data: { targetPersonIds: [dana.id] },
    });

    await page.reload();
    await page.locator('.app-chrome').getByRole('button', { name: 'Dana', exact: true }).click();
    await page.getByRole('link', { name: 'Routines' }).click();

    // Without this a client has a program in their list with no idea who wrote it, which is the
    // difference between being coached and being handed a checklist.
    await expect(page.getByText('Dana Week 1')).toBeVisible();
    await expect(page.getByText('From Nate')).toBeVisible();
  });
});
