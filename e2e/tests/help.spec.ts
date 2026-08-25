import { test, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { goHardOffline, goOnline } from './support/offline';

// The handbook is a static reading surface -- no queries, no writes, no connectivity branch -- so
// it earns no row on .claude/rules/resilience.md's register. What does need proving is that it is
// genuinely reachable and readable with no network, since "works in the basement" is the whole
// reason it is a route in the app rather than a page on the marketing site.
//
// The cold-boot half of that (a hard refresh with no network, served by the service worker) lives
// in offline-durability.spec.ts, which runs against a production build under
// playwright.pwa.config.ts. This file covers the in-session half, which the default dev-server
// project can prove.
//
// NOT covered here, deliberately: that the handbook's Trends copy matches the chart "?" panel's.
// Both render `EXERCISE_METRICS[…].dotMeaning` from the same module -- HelpTab.test.jsx asserts the
// handbook side across every metric and chartHelp.test.js asserts the ChartHelp side, so an e2e
// would need a seeded exercise and a metric switch to re-prove something two unit tests already
// pin. The tab-switching cost is real; the added confidence is not.

async function openHelp(page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/app\/help/);
}

// The handbook's own contents links repeat tab names ("Routines", "History", "Trends"), and the
// tab bar is on screen at the same time -- so an unscoped getByRole('link') is a strict-mode
// violation waiting to happen. Always reach the contents through its own landmark.
function contents(page) {
  return page.getByRole('navigation', { name: 'Handbook contents' });
}

test.describe('Handbook', () => {
  test('reaches the handbook from the profile dropdown, directly above Contact Us', async ({ page, request }) => {
    await registerHousehold(page, request, 'Thackeray');

    await page.locator('.header-bar').getByRole('button').click();
    const items = await page.getByRole('menuitem').allTextContents();
    // Adjacency is the claim: answer it yourself, then ask a human.
    expect(items.indexOf('Contact Us') - items.indexOf('Help')).toBe(1);

    await page.getByRole('menuitem', { name: 'Help' }).click();
    await expect(page).toHaveURL(/\/app\/help/);
    await expect(page.getByRole('heading', { name: 'Huddle Handbook' })).toBeVisible();
  });

  test('a contents link jumps to that section instead of leaving the page', async ({ page, request }) => {
    await registerHousehold(page, request, 'Bronte');
    await openHelp(page);

    await contents(page).getByRole('link', { name: 'Routines', exact: true }).click();

    // Still on the handbook -- these are in-page anchors, not routes.
    await expect(page).toHaveURL(/\/app\/help#routines/);
    const heading = page.getByRole('heading', { name: 'Routines', exact: true });
    await expect(heading).toBeVisible();

    // scroll-margin-top has to clear the sticky chrome, or the anchored heading parks underneath
    // the tab bar and the reader lands mid-paragraph on the wrong section. jsdom computes no
    // layout, so this is the only place it can be asserted. Verified non-vacuous: setting
    // .help-section's scroll-margin-top to 0 lands the heading at y=32.9 against a floor of 56.
    const chrome = await page.locator('.app-chrome').boundingBox();
    const box = await heading.boundingBox();
    expect(chrome).not.toBeNull();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(chrome!.y + chrome!.height);
  });

  test('the whole handbook is readable with no connection', async ({ page, request }) => {
    await registerHousehold(page, request, 'Villanueva');
    await openHelp(page);
    await expect(page.getByRole('heading', { name: 'Huddle Handbook' })).toBeVisible();

    // Navigate away, drop the network, then come back through the menu -- so this proves the route
    // is reachable offline, not merely that an already-painted page survived.
    await page.getByRole('link', { name: 'Log', exact: true }).click();
    await goHardOffline(page);
    await openHelp(page);

    await expect(page.getByRole('heading', { name: 'Huddle Handbook' })).toBeVisible();
    // A section from the far end of the page, and a sentence from inside it: the content ships in
    // the bundle rather than being fetched, so none of it depends on the network.
    await expect(page.getByRole('heading', { name: 'Losing the connection' })).toBeVisible();
    await expect(page.getByText(/estimated 1RM = weight/)).toBeVisible();

    await goOnline(page);
  });
});
