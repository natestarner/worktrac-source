import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { registerHousehold } from './support/auth';

// The Log picker's exercise groups are bounded by ROWS of chips, not by a count of items, and the
// clip itself is pure CSS (.picker-chip-wrap--clipped). jsdom lays nothing out, so this file is
// the ONLY place the bound can actually be proven -- ExercisePicker.test.jsx mocks
// useChipRowOverflow precisely because it has no layout to measure.
//
// Two halves, and they fail independently:
//   1. the clip lands on a row boundary (CSS), and
//   2. the chips past it are inert (the hook + the component).
// The second is the one that looks fine and isn't: a clipped-but-present chip is still focusable,
// still in the accessibility tree, and still passes Playwright's own toBeVisible().

const EXPECTED_ROWS = 9;

async function apiContext(page: Page, request: APIRequestContext) {
  const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
  const { apiUrl } = await (await request.get('/config.json')).json();
  const headers = { Authorization: `Bearer ${token}` };
  const people = await (await request.get(`${apiUrl}/api/people`, { headers })).json();
  return { apiUrl, headers, personId: people[0].id as number };
}

// Favoriting is what puts an exercise in the picker, and it is far and away the cheapest way to
// build a list long enough to overflow nine rows.
async function seedFavorites(page: Page, request: APIRequestContext, count: number) {
  const { apiUrl, headers, personId } = await apiContext(page, request);
  const catalog = await (await request.get(`${apiUrl}/api/exercises`, { headers })).json();
  for (const exercise of catalog.slice(0, count)) {
    await request.put(`${apiUrl}/api/people/${personId}/exercises/${exercise.id}/favorite`, { headers });
  }
  return catalog.slice(0, count).map((e: { name: string }) => e.name);
}

// Seeding goes in behind the app's back, so the picker is still showing the list it fetched at
// boot. Leaving the tab and coming back is what refreshes it: LogTab invalidates
// personExercises whenever it returns to the picker, which beats the 60s staleTime that would
// otherwise leave these sections looking empty.
async function reloadPicker(page: Page) {
  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('link', { name: 'Log' }).click();
}

function clippedWrap(page: Page) {
  return page.locator('.picker-chip-wrap--clipped');
}

test.describe('Log picker bounds', () => {
  // A phone, deliberately. The bound exists because vertical room is the scarce resource on the
  // screen someone reads mid-set -- and it is width-sensitive by design: at the default 1280px
  // desktop viewport forty chips fit inside nine rows, so nothing is clipped and there is nothing
  // to assert. That responsiveness is the feature (a wider screen shows MORE items in the same
  // nine rows), which is exactly why the number of items is not what is pinned here.
  test.use({ viewport: { width: 390, height: 844 } });

  test('clips the favorites list to nine rows and makes the overflow genuinely hidden', async ({ page, request }) => {
    await registerHousehold(page, request, 'Rowan');
    await seedFavorites(page, request, 40);
    await reloadPicker(page);

    await expect(page.getByRole('button', { name: 'Show all 40 favorites' })).toBeVisible();

    const wrap = clippedWrap(page);
    await expect(wrap).toHaveCount(1);

    // The clip lands on a row boundary. Counting DISTINCT tops among the chips that are still
    // reachable expresses "nine rows" directly, without re-deriving the calc() from CSS vars --
    // if the height were off by even a few pixels this would read 8 or 10.
    const visibleRows = await wrap.evaluate((el) => {
      const tops = new Set<number>();
      for (const child of Array.from(el.children)) {
        if ((child as HTMLElement).hasAttribute('inert')) continue;
        tops.add(Math.round(child.getBoundingClientRect().top));
      }
      return tops.size;
    });
    expect(visibleRows).toBe(EXPECTED_ROWS);

    // Something really is cut off -- otherwise every assertion here is vacuous.
    const overflowing = await wrap.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(overflowing).toBe(true);

    // The overflow is inert, so it is out of reach of a keyboard and a screen reader too, not
    // merely painted over.
    const inertCount = await wrap.evaluate(
      (el) => Array.from(el.children).filter((c) => (c as HTMLElement).hasAttribute('inert')).length,
    );
    expect(inertCount).toBeGreaterThan(0);
  });

  test('reveals the whole list on Show all, and re-clips it on Collapse', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sky');
    const names = await seedFavorites(page, request, 40);
    await reloadPicker(page);

    const last = names[names.length - 1];
    await expect(clippedWrap(page)).toHaveCount(1);

    await page.getByRole('button', { name: 'Show all 40 favorites' }).click();

    // No clipped container left, nothing inert, and the last chip is genuinely usable -- clicking
    // it has to open that exercise, which a merely-unclipped-but-still-inert chip could not do.
    await expect(clippedWrap(page)).toHaveCount(0);
    const stillInert = await page
      .locator('.picker-chip-wrap')
      .evaluate((el) => Array.from(el.children).filter((c) => (c as HTMLElement).hasAttribute('inert')).length);
    expect(stillInert).toBe(0);

    await page.getByRole('button', { name: 'Collapse favorites' }).click();
    await expect(clippedWrap(page)).toHaveCount(1);

    await page.getByRole('button', { name: 'Show all 40 favorites' }).click();
    await page.getByRole('button', { name: last, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();
  });

  // Every chip must be exactly one row tall, or the clip stops landing on a row boundary. A long
  // name is the thing that would break it, so it is pinned rather than assumed.
  test('keeps a long exercise name on a single line, with the full name still addressable', async ({ page, request }) => {
    await registerHousehold(page, request, 'Wren');
    await seedFavorites(page, request, 12);
    await reloadPicker(page);

    const heights = await page.locator('.picker-chip-wrap').evaluate((el) =>
      Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().height)),
    );
    expect(new Set(heights).size).toBe(1);

    // The name is pinned as the accessible name even where the text is visually truncated -- both
    // test layers look exercises up by name.
    const firstName = await page.locator('.picker-chip').first().getAttribute('aria-label');
    await expect(page.getByRole('button', { name: firstName!, exact: true })).toBeVisible();
  });

  // The bound must not follow the person across a switch: ExercisePicker is remounted on
  // key={activePersonId} precisely so one person's expanded list isn't showing on another's.
  test('does not carry an expanded list from one person to the next', async ({ page, request }) => {
    await registerHousehold(page, request, 'Ash');
    await seedFavorites(page, request, 40);
    await reloadPicker(page);

    await page.getByRole('button', { name: 'Show all 40 favorites' }).click();
    await expect(clippedWrap(page)).toHaveCount(0);

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Bo');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    // The new person becomes active and starts on their own (empty) picker.
    await expect(page.getByPlaceholder('Search all exercises')).toBeVisible();

    await page.locator('.person-pill-bar').getByRole('button', { name: /Ash/ }).click();

    // Back on Ash, the list is collapsed again -- the expansion did not survive the switch.
    await expect(clippedWrap(page)).toHaveCount(1);
  });
});
