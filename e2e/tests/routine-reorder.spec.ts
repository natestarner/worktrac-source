import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { goHardOffline, goOnline } from './support/offline';

// Routines are listed in the person's own order (routines.sort_order, V61/V62) rather than
// created_at ASC, which used to put the routine someone built first at the top of both this tab
// and the Log picker's quick-start block.
//
// The POINTER path is what this file exists for. RoutinesTab.test.jsx covers the keyboard path
// (which is hand-rolled precisely so it is unit-testable), but dnd-kit's PointerSensor derives
// everything from measured DOM rects, so a real drag can only be proven in a real browser.

const ROUTINE_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

async function seedRoutines(page: Page, request: APIRequestContext, names: string[]) {
  const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
  const { apiUrl } = await (await request.get('/config.json')).json();
  const headers = { Authorization: `Bearer ${token}` };
  const people = await (await request.get(`${apiUrl}/api/people`, { headers })).json();
  const personId = people[0].id;
  const catalog = await (await request.get(`${apiUrl}/api/exercises`, { headers })).json();

  for (const name of names) {
    await request.post(`${apiUrl}/api/people/${personId}/routines`, {
      headers,
      data: { name, exerciseIds: [catalog[0].id] },
    });
  }

  // Seeding goes in behind the app back, so the Routines tab would otherwise render the empty
  // list it fetched at boot -- still "fresh" under the 60s staleTime, and nothing on that tab
  // invalidates it the way LogTab does for the picker. A reload is what forces it: routines is
  // one of the keys offlineCacheWarm marks refreshAfterRestore, so the boot warm refetches it.
  await page.reload();
  await expect(page.getByRole("link", { name: "Routines" })).toBeVisible();
}

// Reads the on-screen order straight from the routine cards, which render in DOM order -- so
// this is the rendered order, not an inference from measured coordinates. Each card's text
// begins with its routine name.
//
// toHaveCount auto-waits, which the earlier locator.count() version did not: measuring a tab that
// had not finished rendering silently reported an empty (or short) order rather than failing.
// Callers wrap this in expect.poll: committing the order refetches, so the list re-renders a
// beat after Done. A bare toEqual on the returned array is one-shot and would capture the
// pre-refetch order -- correct data, read too early.
async function visibleRoutineOrder(page: Page, names: string[]) {
  const cards = page.locator('.card');
  await expect(cards).toHaveCount(names.length);
  const texts = await cards.allTextContents();
  return texts.map((text) => names.find((name) => text.trim().startsWith(name))).filter(Boolean);
}

test.describe('Routine reordering', () => {
  test('drag reorders the list, and the new order survives a reload', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nico');
    await seedRoutines(page, request, ROUTINE_NAMES);

    await page.getByRole('link', { name: 'Routines' }).click();
    await expect.poll(() => visibleRoutineOrder(page, ROUTINE_NAMES)).toEqual(ROUTINE_NAMES);

    await page.getByRole('button', { name: 'Reorder routines' }).click();

    // Drag Echo (last) up onto Alpha (first). dnd-kit's PointerSensor has a 4px activation
    // distance, so the pointer has to actually travel before the drag starts -- a single
    // move-and-release never activates it.
    const source = page.getByRole('button', { name: 'Reorder: Echo (5 of 5)' });
    const target = page.getByRole('button', { name: 'Reorder: Alpha (1 of 5)' });
    const from = (await source.boundingBox())!;
    const to = (await target.boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(page.getByRole('button', { name: 'Reorder: Echo (1 of 5)' })).toBeVisible();

    // dnd-kit suppresses clicks while a drag is active (a document-level capture listener added
    // in handleStart) and removes it on a 50ms setTimeout after the drop -- so the drag's own
    // synthetic click can't be read as a tap. A real person cannot drop and reach Done inside
    // 50ms; Playwright can, and the click is swallowed with no error. This is the rare case where
    // a fixed wait is the honest tool: what we are waiting out is a fixed timer in a dependency,
    // with no observable signal to poll for.
    await page.waitForTimeout(150);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Reorder routines' })).toBeVisible();

    const expected = ['Echo', 'Alpha', 'Bravo', 'Charlie', 'Delta'];
    await expect.poll(() => visibleRoutineOrder(page, ROUTINE_NAMES)).toEqual(expected);

    // The reload is the point: sort_order has to have reached the database, not just the cache.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Reorder routines' })).toBeVisible();
    await expect.poll(() => visibleRoutineOrder(page, ROUTINE_NAMES)).toEqual(expected);
  });

  // The Log picker shows only the first four routines, so the arrangement set on the Routines tab
  // is exactly what decides which four those are. That coupling is the whole reason reordering
  // was worth building.
  test('the Log picker quick-start shows the first four in the persons own order', async ({ page, request }) => {
    await registerHousehold(page, request, 'Remy');
    await seedRoutines(page, request, ROUTINE_NAMES);

    await page.getByRole('link', { name: 'Routines' }).click();
    await page.getByRole('button', { name: 'Reorder routines' }).click();

    // Keyboard here rather than a drag -- this test is about the picker, and the pointer path is
    // already proven above.
    await page.getByRole('button', { name: 'Reorder: Echo (5 of 5)' }).focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('button', { name: 'Reorder: Echo (1 of 5)' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('link', { name: 'Log' }).click();

    await expect(page.getByRole('button', { name: /Echo/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Charlie/ })).toBeVisible();
    // Fifth in the new order, so it is behind the disclosure rather than on screen.
    await expect(page.getByRole('button', { name: /Delta/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Show all 5 routines' }).click();
    await expect(page.getByRole('button', { name: /Delta/ })).toBeVisible();

    await page.getByRole('button', { name: 'Collapse routines' }).click();
    await expect(page.getByRole('button', { name: /Delta/ })).toHaveCount(0);
  });

  // Routine CRUD is Tier-3 (online-gated). The gate has to be on the way IN -- refusing at Done,
  // after someone has arranged five routines, would throw the arrangement away.
  test('refuses to open the reorder mode while offline, rather than failing on Done', async ({ page, request }) => {
    await registerHousehold(page, request, 'Sasha');
    await seedRoutines(page, request, ROUTINE_NAMES);

    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page.getByRole('button', { name: 'Reorder routines' })).toBeEnabled();

    await goHardOffline(page);
    await expect(page.getByRole('button', { name: 'Reorder routines' })).toBeDisabled();

    await goOnline(page);
    await expect(page.getByRole('button', { name: 'Reorder routines' })).toBeEnabled();
  });
});
