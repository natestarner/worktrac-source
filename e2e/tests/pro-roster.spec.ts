import { expect, test } from '@playwright/test';
import { addMemberLogin, loginAs, registerHousehold, setBillingPlan, setMemberVisibility } from './support/auth';
import { addPerson } from './support/people';
import { logSetAt, pickExercise } from './support/exercises';

// The roster, end to end through the browser.
//
// RosterTest covers the ordering and the arithmetic at the API. What only a browser proves is the
// half above HTTP: that the screen is REACHABLE at all (it hangs off the account menu, behind a
// plan-gated entry), that the rows render in the order the server sent rather than in whatever
// order React felt like, and that "never trained" reads as a sentence rather than as a number.
test.describe('Pro — the roster', () => {

  // The entry point is gated on PlanFeature.ROSTER, so a Free or Plus household has no door here.
  async function openRoster(page) {
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Clients' }).click();
  }

  test('is reachable on Pro, in the account’s own vocabulary', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    // The reload has to come BEFORE adding Sam, not after. setBillingPlan is an out-of-band API
    // call the client doesn't know about until a fresh /me -- the reload is what picks up PRO
    // (and the "Clients" menu item's plan gate with it), never a step to skip. But the ROSTER
    // read is warmed with `refreshAfterRestore` deliberately OFF (offlineCacheWarm.js): a reload
    // AFTER adding Sam would boot from a boot-warmed snapshot that can legitimately predate him,
    // by design, to keep the busiest network moment (boot) from forcing every read fresh. Adding
    // Sam in the SAME session as the check instead relies on AddPersonModal's own roster
    // invalidation (the same "this action changed who's on the roster" rule a logged set already
    // follows), which is immediate and carries no such exemption.
    await page.reload();
    await addPerson(page, 'Sam');

    await openRoster(page);

    // "Clients", not "Family members": the menu label and the heading both come from AccountVocab,
    // which the server derives from the tier.
    await expect(page.getByText('Clients', { exact: true })).toBeVisible();
    // The trainer is not their own client -- only Sam belongs on this screen.
    await expect(page.getByText('Sam', { exact: true })).toBeVisible();
    await expect(page.getByText('Nate', { exact: true })).not.toBeVisible();
  });

  // ⚠️ THE TRAINER IS NOT ONE OF THEIR OWN CLIENTS. RosterService reads everyone the caller can
  // see, which includes the trainer's own training profile -- so with nobody else on the account
  // yet, filtering it out (RosterTab.jsx) leaves the empty state rather than a roster of one.
  test('does not list the owner among their own clients', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await page.reload();

    await openRoster(page);

    await expect(page.getByText('No clients yet')).toBeVisible();
    await expect(page.getByText('Nate', { exact: true })).not.toBeVisible();
  });

  // ⚠️ The door is closed on a family tier. Not a refusal -- the endpoint answers a Plus household
  // perfectly well -- but a roster of four people in one house sorted by who trained least recently
  // is not a screen worth offering, and offering it would dilute the family product.
  test('has no entry point on a family plan', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PLUS');
    await page.reload();

    await page.locator('.header-bar').getByRole('button').click();

    await expect(page.getByRole('menuitem', { name: 'Clients' })).toHaveCount(0);
    // The rest of the menu is untouched -- this is one hidden item, not a broken menu.
    await expect(page.getByRole('menuitem', { name: 'App Settings' })).toBeVisible();
  });

  // ⚠️ THE ASSERTION THE SCREEN EXISTS FOR. Somebody who has never logged anything is the MOST
  // urgent row, not the least -- they are the client who quietly never started. A "never" sorted to
  // the bottom of a roster of forty is the one person a trainer would never scroll to.
  test('puts the client who has never trained above the one who just did', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PRO');
    await addPerson(page, 'Busy');
    await addPerson(page, 'Never');
    await page.reload();

    // Log a real set for Busy, through the UI, so the roster is reading genuine training data
    // rather than something seeded behind the app's back.
    await page.locator('.app-chrome').getByRole('button', { name: 'Busy', exact: true }).click();
    await pickExercise(page, 'Barbell Bench Press');
    await logSetAt(page, 135, 5);

    await openRoster(page);

    // ⚠️ Wait for the roster to have RENDERED before reading it, and read it ONCE as one block of
    // text rather than asserting on individual `getByText` locators. Two reasons, not one:
    //   - The name and activity divs are adjacent siblings under one wrapper with no separator in
    //     between, so the wrapper's own concatenated text also contains the activity sentence as a
    //     substring -- a non-exact getByText resolves to both it and the leaf (e2e-tests.md).
    //   - A roster reached via addPerson + a just-landed logged set can transiently carry TWO
    //     invalidation sources (the add and the set-log both invalidate ['roster'] independently --
    //     RosterTab.jsx / queryClient.js), and an in-flight refetch racing a settling one can leave
    //     a `getByText` locator matching a stale node alongside the fresh one for a beat. Reading
    //     `.innerText()` once, after the text is confirmed present, takes whatever the DOM shows at
    //     that single instant rather than asking Playwright to reconcile two async locator resolves.
    // These two also carry their own claim: "never" is a SENTENCE, not a number. RosterEntryDto
    // sends null rather than a sentinel precisely so this cannot render "9999 days ago". NOT "Has
    // never logged a workout" -- that sentence is RosterTab.describeActivity's OTHER never-trained
    // branch, for somebody with a login. `addPerson` creates a person with none (that needs
    // `addMemberLogin`), so the correct copy names the no-login case instead.
    const rosterCard = page.locator('.card.card-flush');
    await expect(rosterCard).toContainText('No workouts yet — this client has no login');
    await expect(rosterCard).toContainText('Trained today · 1 week running');

    // The claim is about what a reader sees top to bottom, and innerText is that -- read once,
    // after the two assertions above confirm the content has actually settled.
    const rendered = await rosterCard.innerText();
    expect(rendered.indexOf('Never')).toBeLessThan(rendered.indexOf('Busy'));
  });

  // ⚠️ A CLIENT IS NOT OFFERED IT AT ALL, and this test is why the code says so. The endpoint
  // carries VIEW_OTHER_PEOPLE, which a private client does not hold -- so the interceptor refuses
  // them with a 403 before the service runs. The menu item was offered to them anyway, on the
  // strength of a javadoc claiming they would see a roster of just themselves. They would have seen
  // an error screen. A control the server will refuse must not be offered (member-access.md).
  test('is not offered to a private client at all', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Dana');

    const dana = await addMemberLogin(page, request, ownerEmail, 'Dana', undefined, 'PRO');
    await setMemberVisibility(request, ownerEmail, false);
    await loginAs(page, dana.email, dana.password);

    await page.locator('.header-bar').getByRole('button').click();

    await expect(page.getByRole('menuitem', { name: 'Clients' })).toHaveCount(0);
    // Their own screens are untouched -- private is not read-only, and this is one hidden item.
    await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible();
  });
});
