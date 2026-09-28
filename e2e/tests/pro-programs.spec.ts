import { expect, test } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { addPerson } from './support/people';

// A program, end to end: a trainer writes the numbers on a routine, assigns it to a client, and the
// client's Log screen shows what they are meant to hit.
//
// RoutineControllerTest covers the copy and the provenance stamp at the API. What only a browser
// proves is the bit that makes the feature real -- that a routine's target survives the round trip
// and renders on the screen somebody logs from.
//
// The builder's target fields are hidden for now (RoutineFormModal's `showTargetInputs`), so the
// targets are written through the API. When the fields come back, drive these through the builder
// again -- that is the path a trainer actually uses.
test.describe('Pro — programs', () => {

  async function openRoutines(page) {
    await page.getByRole('link', { name: 'Routines' }).click();
  }

  async function apiAs(request, email) {
    const { apiUrl } = await (await request.get('/config.json')).json();
    const token = (await (await request.post(`${apiUrl}/api/auth/login`, {
      data: { email, password: 'password123' },
    })).json()).token;
    return { apiUrl, auth: { Authorization: `Bearer ${token}` } };
  }

  // A one-exercise routine on the household's own person, carrying the given target. Written behind
  // the app's back, so the caller reloads before looking (routines are refreshAfterRestore).
  async function seedRoutineWithTarget(request, email, name, target) {
    const { apiUrl, auth } = await apiAs(request, email);
    const people = await (await request.get(`${apiUrl}/api/people`, { headers: auth })).json();
    const nate = people.find((p) => p.name === 'Nate');
    const exercises = await (await request.get(`${apiUrl}/api/exercises`, { headers: auth })).json();
    const bench = exercises.find((e) => e.name === 'Barbell Bench Press');
    const response = await request.post(`${apiUrl}/api/people/${nate.id}/routines`, {
      headers: auth,
      data: { name, exercises: [{ exerciseId: bench.id, ...target }] },
    });
    expect(response.ok()).toBeTruthy();
  }

  // ⚠️ THE ASSERTION THE FEATURE EXISTS FOR. A template whose numbers do not travel arrives as a
  // bare list of exercise names, which is a checklist rather than a program.
  test("a routine's target reaches the Log screen", async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await seedRoutineWithTarget(request, ownerEmail, 'Squat Day', { targetWeight: 185, targetReps: 5, targetUnit: 'lb' });
    await page.reload();

    await openRoutines(page);

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
    await seedRoutineWithTarget(request, ownerEmail, 'Heavy', { targetWeight: 225, targetUnit: 'lb' });
    await page.reload();

    await openRoutines(page);
    await expect(page.getByText('Heavy', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Start/ }).first().click();

    await expect(page.getByText('225 lb')).toBeVisible();
    // The Weight STEPPER specifically -- the same locator setStepper uses, rather than a bare
    // getByRole('spinbutton').first(), which would match whatever number field happens to be first.
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

    const { apiUrl, auth } = await apiAs(request, ownerEmail);

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
