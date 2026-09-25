import { expect, test } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { logSetAt, pickExercise } from './support/exercises';

// History's date picker must not move under the thumb that is paging it.
//
// A month spans four, five or six calendar weeks. The grid used to track that, so the picker
// changed height on every page -- and because the phone sheet is anchored to the BOTTOM of the
// screen, a height change moved its TOP: the month name and both chevrons jumped a row up or down
// right where the next tap was about to land. The grid is now always six rows
// (dateRange.js#monthGrid), and this measures the real pixels, which jsdom cannot.
//
// Non-vacuous by construction: the spec checks that the months it pages through genuinely need
// different numbers of weeks, so it can never pass merely because every month it happened to see
// was the same height.

const MONTHS_BACK = 8;

// How many calendar weeks (Sunday start) a month actually needs.
function weeksNeeded(year: number, monthIndex: number) {
  const lead = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  return Math.ceil((lead + days) / 7);
}

test('paging months in the date picker never moves its header', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // phone: the bottom-sheet layout
  // Plus, because the first workout sits months back -- outside Free's window, which would hide it
  // from History and stop the picker paging back to it at all.
  const email = await registerHousehold(page, request, 'Pager');
  await setBillingPlan(request, email, 'PLUS');
  await page.reload();

  const first = new Date();
  first.setDate(15);
  first.setMonth(first.getMonth() - MONTHS_BACK);
  const iso = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-15`;

  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Log a past workout' }).click();
  const modal = page.getByRole('dialog');
  await modal.locator('input[type="date"]').fill(iso);
  await modal.locator('input[type="time"]').fill('09:00');
  await modal.getByRole('button', { name: 'Start adding sets' }).click();
  await pickExercise(page, 'Barbell Deadlift');
  await logSetAt(page, 315, 3);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'View options for Barbell Deadlift' })).toBeVisible();

  await page.getByRole('button', { name: 'Search by date' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a date' });
  const prev = picker.getByRole('button', { name: 'Previous month' });
  const next = picker.getByRole('button', { name: 'Next month' });
  const heading = picker.getByRole('heading', { level: 3 });

  // Let the sheet finish sliding in before taking the reference position.
  const top = async () => (await prev.boundingBox())!.y;
  let reference = await top();
  await expect.poll(async () => {
    const now = await top();
    const settled = now === reference;
    reference = now;
    return settled;
  }).toBe(true);

  const now = new Date();
  const seenWeeks = new Set<number>([weeksNeeded(now.getFullYear(), now.getMonth())]);

  for (let i = 1; i <= MONTHS_BACK; i += 1) {
    const before = await heading.textContent();
    await prev.click();
    await expect(heading).not.toHaveText(before!);

    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    seenWeeks.add(weeksNeeded(m.getFullYear(), m.getMonth()));

    // Both chevrons (the month name shares their row), to within half a pixel.
    const label = await heading.textContent();
    expect((await prev.boundingBox())!.y, `Previous month moved paging to ${label}`).toBeCloseTo(reference, 0);
    expect((await next.boundingBox())!.y, `Next month moved paging to ${label}`).toBeCloseTo(reference, 0);
  }

  // The guard that makes this test mean something (see the header).
  expect(seenWeeks.size, `every month paged through needed the same number of weeks: ${[...seenWeeks]}`).toBeGreaterThan(1);
  // And it really paged all the way back to the first workout.
  await expect(prev).toBeDisabled();
});
