import { test, expect, type Page } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';

// A long History. It draws its newest workouts first and more as the list scrolls
// (useGrowingList.js), and each workout block carries `content-visibility: auto` (HistoryTab.jsx) so
// the browser skips styling and laying out the drawn blocks that are off screen.
//
// What only a real browser can show:
//   - the first page is all that is drawn, and scrolling really does draw the rest -- the unit test
//     fakes the IntersectionObserver, so only this proves the real one fires;
//   - the blocks really do carry `content-visibility`, so a refactor that drops the style fails
//     here, not on a phone;
//   - a long JUMP still lands where it should. An off-screen block that was never drawn has only its
//     estimated height, so "View this exercise's history" on a workout far down the list scrolls
//     past hundreds of estimates. That workout must end up on screen, clear of the sticky tab bar.
//
// What this guards is the OUTCOME, not how it's achieved. Before History's scroll-margin, a smooth
// scroll missed the target here by a whole workout (3/3). With the margin's slack it usually lands
// even when smooth, so this spec cannot tell the two apart; the instant jump is kept because it is
// exact even with a deliberately wrong 20px estimate (checked by hand, see HistoryTab.jsx). The
// "covered" check is proven: it fails with the scroll-margin removed.

const DAYS = 360;

function isoDay(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Matches utils/datetime.js#formatDateLabel for a day that is neither today nor yesterday.
function headerDay(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function seedYear(page: Page, request: Parameters<typeof setBillingPlan>[0]) {
  const { apiUrl } = await (await request.get('/config.json')).json();
  const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
  const headers = { Authorization: `Bearer ${token}` };
  const personId = (await (await request.get(`${apiUrl}/api/people`, { headers })).json())[0].id;
  const rows: string[] = [];
  // Every other day for a year; one to three exercises a workout, so block heights vary the way a
  // real History's do. One set each, to keep the import cheap: on lower, under eight parallel
  // workers on a 5-DTU database, three sets each (~1,080 rows) took 62s to import alone. test.slow()
  // below covers what is left of that.
  for (let day = DAYS; day >= 2; day -= 2) {
    const names = ['Barbell Row', 'Barbell Bench Press', 'Barbell Back Squat'].slice(0, 1 + (day % 3));
    for (const name of names) rows.push(`${name},${isoDay(day)},12:00:00,${100 + (day % 40)},lb,5`);
  }
  const imported = await request.post(`${apiUrl}/api/people/${personId}/import`, {
    headers,
    data: { csv: `Exercise,Date,Time,Weight,Unit,Reps\n${rows.join('\n')}\n`, filename: 'year.csv' },
  });
  expect(imported.ok()).toBe(true);
}

test('a long History skips off-screen workouts and still lands a long jump on target', async ({ page, request }) => {
  test.slow(); // a year of History imported through lower's shared database
  const email = await registerHousehold(page, request, 'Long');
  await setBillingPlan(request, email, 'PLUS'); // a year back is outside Free's 90-day window
  await seedYear(page, request);
  await page.reload();
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/lb\s?×/).first()).toBeVisible();

  // Every workout block skips rendering while off screen.
  const blockOf = (text: RegExp) => page.getByText(text).first().locator('xpath=../..');
  const firstBlock = blockOf(new RegExp(`^${headerDay(2)} ·`));
  await expect(firstBlock).toHaveCSS('content-visibility', 'auto');

  // Only the first page is drawn: 180 workouts are held, 40 are on the page.
  const edits = page.getByRole('button', { name: 'Edit', exact: true });
  await expect(edits).toHaveCount(40);

  // A workout ~10 months down: open its exercise chooser and ask for that exercise's history.
  const target = 300;
  const targetHeader = page.getByText(new RegExp(`^${headerDay(target)} ·`)).first();
  const targetBlock = targetHeader.locator('xpath=../..');
  // Scrolled to, the way a person gets there: each time the end of the list comes near, more is
  // drawn, until the target exists.
  await expect(async () => {
    await page.getByTestId('history-more').scrollIntoViewIfNeeded({ timeout: 2000 });
    await expect(targetHeader).toBeAttached({ timeout: 1000 });
  }).toPass({ timeout: 30000 });
  // The target is in the last page, so by now every workout held is drawn, and nothing is left to
  // draw from.
  await expect(edits).toHaveCount(180);
  await expect(page.getByTestId('history-more')).toHaveCount(0);
  await targetBlock.getByRole('button', { name: 'View options for Barbell Row' }).scrollIntoViewIfNeeded();
  await targetBlock.getByRole('button', { name: 'View options for Barbell Row' }).click();
  await page.getByRole('button', { name: /View this exercise.s history/ }).click();

  // Wait for the smooth scroll to settle, then the workout must be on screen, near the top.
  await expect
    .poll(async () => {
      const a = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(400);
      return a === (await page.evaluate(() => window.scrollY));
    }, { timeout: 15000 })
    .toBe(true);
  await expect(targetHeader).toBeInViewport();
  // ...and not merely inside the viewport but actually visible: nothing (the sticky tab bar) painted
  // over it. `block: 'start'` without History's scroll-margin parked it right behind the chrome.
  const covered = await targetHeader.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
    return !(hit && (hit === el || el.contains(hit)));
  });
  expect(covered, 'the target workout is hidden behind the sticky chrome').toBe(false);
});
