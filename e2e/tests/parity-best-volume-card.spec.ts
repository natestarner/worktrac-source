import { APIRequestContext, Page, expect } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

// The Log screen's "Last time" card switches to the earlier session holding the volume record.
//
// Online the session comes from the exercise summary; degraded, the summary for a never-opened
// exercise is unavailable and it comes from History instead (exerciseSummaryFromHistory.js), so
// this is the claim that the two paths show the same thing. The switch is display only: the
// weight prefill keeps following the LAST session whichever view is up.
const EXERCISE = 'Barbell Bench Press';

function isoDay(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// Three workouts, the biggest in the middle: 3000 lb, then 4400 lb (the record), then the last one
// at 1600 lb.
async function seedThreeWorkouts(page: Page, request: APIRequestContext) {
  const { apiUrl } = await (await request.get('/config.json')).json();
  const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
  const headers = { Authorization: `Bearer ${token}` };
  const personId = (await (await request.get(`${apiUrl}/api/people`, { headers })).json())[0].id;
  const rows: string[] = [];
  const workout = (daysAgo: number, weight: number, reps: number[]) =>
    reps.forEach((r, i) => rows.push(`${EXERCISE},${isoDay(daysAgo)},12:0${i}:00,${weight},lb,${r}`));
  workout(6, 100, [10, 10, 10]);
  workout(4, 110, [10, 10, 10, 10]);
  workout(2, 100, [8, 8]);
  const imported = await request.post(`${apiUrl}/api/people/${personId}/import`, {
    headers,
    data: { csv: `Exercise,Date,Time,Weight,Unit,Reps\n${rows.join('\n')}\n`, filename: 'three.csv' },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
}

// A pill or caption on the card, by exact text. Both pages are in the DOM side by side, so a text
// match alone finds the off-page copy too -- and Playwright calls that one "visible" (and even "in
// viewport": it is just beside the card). What is SHOWN is what lies inside the strip's own box.
const onCard = (page: Page, selector: string, text: string) =>
  page.locator(`.summary-card ${selector}`).filter({ hasText: new RegExp(`^${text}$`) });

async function shownOnCard(page: Page, selector: string, text: string): Promise<boolean> {
  const strip = await page.locator('.summary-card-pager').boundingBox();
  const boxes = await Promise.all((await onCard(page, selector, text).all()).map((el) => el.boundingBox()));
  return boxes.some((b) => !!strip && !!b && b.x >= strip.x - 1 && b.x + b.width <= strip.x + strip.width + 1);
}

const expectShown = (page: Page, selector: string, text: string, shown = true) =>
  expect.poll(() => shownOnCard(page, selector, text), { message: `${text} shown on the card` }).toBe(shown);

forEachConnectivityMode<Record<string, never>>('Last time card pages to the best-volume workout', {
  setup: async (page, request) => {
    const email = await registerHousehold(page, request, 'Volume');
    await setBillingPlan(request, email, 'PLUS'); // import is a Plus feature
    await seedThreeWorkouts(page, request);
    // Imported behind the app's back: reload so History (what every degraded mode reads) holds it,
    // and wait until it does before any mode is entered.
    await page.reload();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('110lb×10').first()).toBeVisible();
    return {};
  },
  navigate: (page) => pickExercise(page, EXERCISE),
  act: async (page) => {
    await expectShown(page, '.set-pill', '100lb×8');
    await expectShown(page, '.set-pill', '4×110lb×10', false);
    // A swipe: the strip's own horizontal scroll, as a trackpad sends it. (Back is the button,
    // below, so both ways of paging run in every mode.)
    await page.locator('.summary-card-pager').hover();
    await page.mouse.wheel(300, 0);
  },
  assert: async (page) => {
    await expectShown(page, '.set-pill', '4×110lb×10');
    await expectShown(page, '.summary-card-caption', '.* · 4400 lb');
    await expectShown(page, '.set-pill', '100lb×8', false);
    await expect(page.getByRole('button', { name: 'Show last time' })).toBeVisible();
    // Display only: logging still starts from the last workout's first set.
    await expect(page.getByLabel('Weight (lb)')).toHaveValue('100');
    await expect(page.getByLabel('Reps')).toHaveValue('8');

    await page.getByRole('button', { name: 'Show last time' }).click();
    await expectShown(page, '.set-pill', '100lb×8');
    await expectShown(page, '.set-pill', '4×110lb×10', false);
  },
});
