import { expect, test } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';

// The account dropdown is reached by scoping to .header-bar rather than matching the account
// holder's name, which varies per test -- the same idiom admin.spec.ts uses, and for the same
// reason. Note PlanBadge now also lives in that bar: on both Free and Plus it renders a LINK (not
// a button), so the "only button in the header" assumption those specs rely on still holds.
async function openAccountMenu(page) {
  await page.locator('.header-bar').getByRole('button').click();
}

// The plan screen, both sides of it.
//
// STRIPE IS DELIBERATELY ABSENT from this suite. Plans are set through the test-support endpoint,
// which writes the same `comped` flag a founding household uses -- so these specs exercise the
// real entitlement derivation rather than a fixture, and the suite needs no Stripe credentials in
// any environment. Driving Stripe's own card form would be testing Stripe, slowly and flakily.
test.describe('billing', () => {
  test('a Free household is offered Plus, with yearly leading', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Plan & billing' }).click();

    await expect(page).toHaveURL(/\/app\/billing/);
    await expect(page.getByRole('button', { name: 'Upgrade to Plus' })).toBeVisible();
    // Yearly leads because the marketing pricing card headlines $29/year -- the price must not
    // change shape between the page they just read and the screen they pay on.
    await expect(page.getByRole('radio', { name: /Yearly/ })).toBeChecked();

    // Free is permanent, so deferring costs nothing. This is an equal-weight escape, not fine print.
    await expect(page.getByRole('button', { name: /Start with Free/ })).toBeVisible();
  });

  test('the header offers Go Plus on Free and says Plus once upgraded', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Nate');

    // "Go Plus" in the header and "Upgrade to Plus" on the billing screen are deliberately
    // non-containing: Playwright matches accessible names as a case-insensitive substring, so a
    // shared name would make every assertion on either one ambiguous.
    await expect(page.getByRole('link', { name: 'Go Plus' })).toBeVisible();

    await setBillingPlan(request, email, 'PLUS');
    await page.reload();

    await expect(page.getByRole('link', { name: 'Go Plus' })).toHaveCount(0);
    // exact:true -- "Plus" is a substring of "Profile", which is the account menu's first item and
    // lives in this same header.
    await expect(page.getByText('Plus', { exact: true })).toBeVisible();
  });

  test('clicking the header Plus badge opens the billing screen', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, email, 'PLUS');
    await page.goto('/app/log');

    // exact:true -- see the comment on the earlier test; "Plus" is also a substring of "Profile".
    await page.getByRole('link', { name: 'Plus', exact: true }).first().click();

    await expect(page).toHaveURL(/\/app\/billing/);
  });

  // Regression, root-caused live rather than theorized: React.StrictMode (main.jsx) double-invokes
  // the checkout-reconcile effect (mount -> cleanup -> mount) on every load, including this one --
  // this app runs the dev build under e2e, same as local dev. The effect used to guard its success
  // path with a per-invocation `cancelled` flag set by that first cleanup, so the FIRST
  // invocation's in-flight reconcile call resolved into a closure already marked cancelled,
  // discarding the celebration (and refreshPeople/invalidateQueries/the URL cleanup) silently,
  // while the SECOND invocation's reconciledRef guard -- already set synchronously by the first --
  // never even attempted a second reconcile. The reconcile call and its server-side effects still
  // land either way (confirmed against the real billing_events audit trail: a completed
  // CHECKOUT_RECONCILED row with nothing shown for it), which is exactly why this reads as
  // "the upgrade worked, but no celebration" rather than as an outright failure.
  //
  // Delaying the reconcile response is what actually exposes the race: a fast/instant response
  // lets the first invocation's continuation finish before StrictMode's synchronous
  // cleanup-then-remount even runs, which is also why this could never be reproduced as a unit
  // test -- jsdom/RTL does not reproduce React's real double-invoke timing for this effect at all
  // (measured directly, including with a deferred mock explicitly wrapped in <StrictMode>; only
  // one invocation ever fired there). This is the real regression guard for that bug.
  test('celebrates a real checkout return even under StrictMode double-invoke', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await page.route('**/api/billing/checkout-session/*/reconcile', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({ json: { plan: 'PLUS', status: 'ACTIVE', pro: true } });
    });

    // A real top-level navigation, not client-side routing -- this is what Stripe's return_url
    // redirect actually does, and it's what puts the checkout param in the URL on first paint
    // rather than via a client-side search-param update.
    await page.goto('/app/billing?checkout=cs_test_fake_session_id');

    await expect(page.getByText('Welcome to Huddle Plus')).toBeVisible();
  });

  test('a Plus household sees its plan rather than an upgrade', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, email, 'PLUS');

    await page.goto('/app/billing');

    await expect(page.getByText('Huddle Plus')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upgrade to Plus' })).toHaveCount(0);
  });

  // The gates, from the outside. Both halves matter: the Plus feature is withheld, and the thing
  // that must NEVER be withheld is still there.
  test('importing is offered to Plus and explained to Free, while export is always offered',
    async ({ page, request }) => {
      const email = await registerHousehold(page, request, 'Nate');

      await page.goto('/app/settings');
      await expect(page.getByRole('button', { name: 'Import data' })).toHaveCount(0);
      await expect(page.getByText(/Importing past workouts is part of Plus/)).toBeVisible();
      // ⚠️ Exporting is free on BOTH plans. A household must always be able to take its own data
      // out, and the privacy policy's self-serve data rights depend on this staying true.
      await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();

      await setBillingPlan(request, email, 'PLUS');
      await page.reload();

      await expect(page.getByRole('button', { name: 'Import data' })).toBeVisible();
      await expect(page.getByText(/part of Plus/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
    });

  // The gate at the point of use, not just at the point of failure. Enable login used to be
  // offered regardless of plan, so a Free owner filled out the whole invite modal and only THEN
  // got refused by a toast -- exactly the "control the server will refuse must not be offered"
  // shape member-access.md calls out. The client already knows the plan, so it swaps the row's
  // control for a link to Plus instead of a doomed round trip.
  test('a Free household is offered Plus on the Logins row instead of Enable login', async ({ page, request }) => {
    const email = await registerHousehold(page, request, 'Nate');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sam', exact: true }).first()).toBeVisible();

    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Profile' }).click();

    await expect(page.getByRole('button', { name: 'Enable login' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Unlock with Plus' }).click();
    await expect(page).toHaveURL(/\/app\/billing/);

    await setBillingPlan(request, email, 'PLUS');
    await page.goto('/app/profile');

    await expect(page.getByRole('link', { name: 'Unlock with Plus' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enable login' })).toBeVisible();
  });

  // The handbook is a route inside the app precisely so it works with no signal, and it now has to
  // explain the plans. A deep link into the new section is API -- renaming the id breaks it.
  test('the handbook explains the plans at a stable anchor', async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');

    await page.goto('/app/help#plan');

    await expect(page.getByRole('heading', { name: 'Free and Plus' })).toBeVisible();
    // The claim is "a plan decides what a screen SHOWS, never what exists" -- see billing.md. This
    // used to assert "hidden, not removed", which described the app as concealing someone's own
    // training on the very page promising it never deletes anything.
    await expect(page.getByText(/only how much of it is on screen does/)).toBeVisible();
  });
});
