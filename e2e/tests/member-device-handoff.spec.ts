import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { addMemberLogin, loginAs, registerHousehold } from './support/auth';
import { outboxCountText, waitForOutboxDrain } from './support/offline';
import { failNetwork } from './support/faults';
import { pickExercise } from './support/exercises';

// The write endpoint, blocked on its own rather than by taking the whole browser offline.
//
// ⚠️ `goHardOffline` cannot be used in this spec: the next step is a RELOAD, and with no service
// worker in the default project (those specs live in offline-durability.spec.ts) the document
// itself fails to fetch -- `net::ERR_INTERNET_DISCONNECTED` before the app ever boots. Failing
// just this route leaves the app loadable and its login path working while the queued write stays
// exactly as stuck as it would be with no signal at all: an aborted fetch is the same rejected
// promise `shouldRetryWrite` keeps retrying either way.
const LIVE_SETS = /^https?:\/\/[^/]+\/api\/people\/\d+\/live-sets/;

async function addPerson(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add person' }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  // The new person's PILL, not the picker heading -- "Search all exercises" is already on screen
  // for the CURRENT person, so waiting on it can be satisfied before the modal has even closed.
  await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
}

async function logout(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
}

// A bare person name matches the person PILL and the account-menu trigger, so every person
// assertion has to be scoped to the chrome.
function personPill(page: Page, name: string) {
  return page.locator('.app-chrome').getByRole('button', { name, exact: true });
}

// Ends the session the way a REVOKED member's ends, WITHOUT an explicit logout.
//
// ⚠️ This distinction is the entire first test. `logout()` calls clearOutbox(), which deletes the
// signing-out login's queued writes outright -- so nothing can be inherited through that door, by
// design and behind a confirm. The 401 branch of AuthContext's boot deliberately does the
// opposite: it clears the token and the snapshot and leaves the outbox completely alone, because
// a write must never be discarded merely because a request failed. That leftover queue -- durable,
// on disk, belonging to a login that is no longer signed in -- is the thing the next member on
// this device could inherit, and it is reachable for real (a revoked membership, a password reset
// elsewhere, an expired token).
//
// Clearing the two auth keys reproduces that branch's exact end state. It is done in the page
// rather than by forcing a real 401 because the queue must still be queued when the next member
// arrives -- and a 401 is delivered by `client.js` on ANY request, so arranging one would also
// answer the queued write, draining it and dissolving the premise.
async function endSessionWithoutLoggingOut(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('workout-tracker-token');
    localStorage.removeItem('worktrac-auth-snapshot');
  });
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
}

// Two members of ONE household, on ONE device -- the case the storage re-key exists for.
//
// Both persisted stores used to be keyed by account alone, so both members resolved to the same
// entry and `adoptOutboxScope` (then comparing accounts only) saw no change between them:
//
//   the OUTBOX -- member B inherited member A's queued writes and replayed them under B's token,
//     where the person guards refuse them as writes onto somebody else's data. A 403 is terminal
//     for a durable write, so A's work ends up as dead writes in B's outbox, gone from A's screen.
//   APP STATE -- B opened on whichever person A last selected, with A's half-typed weight and reps
//     still in the fields.
//
// The unit tests pin each store directly. What only a browser can show is the whole path: a real
// queued offline write, a session that ends without a logout, a second member signing in on top of
// it, and the first member's work still being theirs when they come back.
test.describe('Two members sharing a device', () => {
  // Two MEMBERS, never a member and the owner: the owner's own person already holds a membership
  // (UX_account_memberships_account_person allows one login per person, and addMemberLogin returns
  // 409 for it), and this is about two members sharing a device anyway.
  async function household(page: Page, request: APIRequestContext) {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');
    await addPerson(page, 'Alex');
    return {
      sam: await addMemberLogin(page, request, ownerEmail, 'Sam'),
      alex: await addMemberLogin(page, request, ownerEmail, 'Alex'),
    };
  }

  test("a member's queued offline writes are never replayed under the other member's login", async ({ page, request }) => {
    const { sam, alex } = await household(page, request);

    // Sam signs in and queues a set that cannot reach the server. No weight is set: this logs a
    // bodyweight set, and the number is genuinely incidental here -- WHOSE outbox the write lands
    // in is the claim.
    await loginAs(page, sam.email, sam.password);
    await pickExercise(page, 'Barbell Bench Press');
    const blocked = await failNetwork(page, LIVE_SETS);
    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Sam's session ends with that write still queued and still on disk. The reload inside runs
    // App.jsx's restoreOutbox against the persisted scope pointer, so Sam's writes are back in the
    // live mutation cache before anyone signs in -- which is precisely the loaded gun.
    await endSessionWithoutLoggingOut(page);

    // The route opens again BEFORE the second member arrives, deliberately. If it stayed shut, a
    // leaked write would fail on the network and look queued rather than refused -- the 403 from
    // the person guards, which is what actually kills it, would never happen and the test would
    // prove nothing.
    blocked.stop();

    // Alex signs in on the same device, and inherits nothing.
    await loginAs(page, alex.email, alex.password);
    // This covers "not queued" AND "not failed": countQueuedWrites counts a write that is paused,
    // retrying, OR terminally errored. Under the account-only key Sam's writes flushed under Alex's
    // token, the person guards refused them, and a 403 is terminal -- so they would sit in Alex's
    // banner as dead writes, and this assertion is what says they do not.
    await expect(page.getByText(/waiting to sync/i)).toBeHidden();
    // And Alex is on Alex's own screen, not parked on whoever used the device last.
    await expect(personPill(page, 'Alex')).toHaveAttribute('aria-pressed', 'true');

    // Sam comes back. Their work was never Alex's to lose: it is still on disk under Sam's own key,
    // and this login restores it. (Alex's logout clears ALEX's outbox key -- Sam's is a different
    // key, which is the whole point.)
    //
    // The route is shut again first, so "it survived" is asserted as a QUEUED write rather than
    // inferred from the drain. With it open, restoreOutbox and flushOutbox run back to back and the
    // write can land before any assertion sees it -- which would make this leg pass whether the
    // write was restored or silently gone.
    await logout(page);
    blocked.resume();
    await loginAs(page, sam.email, sam.password);
    await expect(outboxCountText(page, 1)).toBeVisible();

    // And with the way open it lands, on Sam's own history.
    blocked.stop();
    await waitForOutboxDrain(page);
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Barbell Bench Press', { exact: true }).first()).toBeVisible();
  });

  // BOTH members carrying queued work at once -- the shape the eviction is most dangerous in.
  //
  // adoptOutboxScope flips the scope pointer to the INCOMING login and only then evicts the
  // outgoing login's mutations. That ordering is deliberate and load-bearing (evicting first would
  // persist "empty" against the OUTGOING key and delete work that is still perfectly good), and its
  // comment justifies it on the grounds that the incoming key is "legitimately empty". This is the
  // case where it is not.
  test('neither member loses queued work when both have some', async ({ page, request }) => {
    const { sam, alex } = await household(page, request);
    const blocked = await failNetwork(page, LIVE_SETS);

    // Sam queues one, and leaves without logging out.
    await loginAs(page, sam.email, sam.password);
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();
    await endSessionWithoutLoggingOut(page);

    // Alex queues one too, and leaves the same way. Sam's write is in the live mutation cache at
    // this point (boot restored it against the pointer), so Alex's login evicts a NON-EMPTY cache
    // -- and that eviction persists against the pointer, which by then names Alex.
    await loginAs(page, alex.email, alex.password);
    await pickExercise(page, 'Barbell Bench Press');
    await page.getByRole('button', { name: /^Log set/ }).click();
    await expect(outboxCountText(page, 1)).toBeVisible();
    await endSessionWithoutLoggingOut(page);

    // Sam returns. Alex's write is now the non-empty cache being evicted, and Sam's own queued
    // write is what the eviction's persist would delete.
    await loginAs(page, sam.email, sam.password);
    await expect(outboxCountText(page, 1)).toBeVisible();

    // Both writes are still each member's own, and both land.
    blocked.stop();
    await waitForOutboxDrain(page);
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Barbell Bench Press', { exact: true }).first()).toBeVisible();

    await logout(page);
    await loginAs(page, alex.email, alex.password);
    await waitForOutboxDrain(page);
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Barbell Bench Press', { exact: true }).first()).toBeVisible();
  });

  // THE UPGRADE PATH, in a browser. Everything above is about a device that has only ever known
  // per-login keys; this is a device that was running the app BEFORE they existed.
  //
  // `worktrac-appstate-<accountId>` is shared by the whole household, so the migration that carries
  // that state forward is the one thing that could hand it to the wrong person -- reintroducing,
  // through the migration itself, exactly the leak the re-key removes.
  //
  // TWO things stop that, and this exercises both, because the first alone hides the second:
  //   1. adoption DELETES the per-account key, so ordinarily there is nothing left to inherit;
  //   2. a TOMBSTONE bounds the fallback to one adoption per account per device, for when that
  //      delete does not happen (a failed write -- private mode, quota).
  // The second leg below puts the key back, exactly as a failed delete would have left it. Without
  // it this test passes with the tombstone removed entirely, which is how it was first written.
  //
  // The tombstone's soundness argument is about WHEN it can fire: at migration time the only login
  // that account has ever had on this device is the one that wrote that state, because member
  // logins did not exist when it was written.
  test('pre-upgrade household state goes to the login that wrote it, and to nobody else', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');
    await addPerson(page, 'Alex');
    const sam = await addMemberLogin(page, request, ownerEmail, 'Sam');

    // The owner parks on Alex -- a third person, so the assertion cannot be satisfied by either
    // login's own default. The owner's would be Nate (the primary); the member's would be Sam.
    await personPill(page, 'Alex').click();
    await expect(personPill(page, 'Alex')).toHaveAttribute('aria-pressed', 'true');

    // Rewind this device to a pre-upgrade install: the same state, under the bare per-account key,
    // with no per-login key and no tombstone. Copied from what the app just wrote rather than
    // hand-built, so the payload is real rather than a guess at the shape.
    //
    // Returns the per-account key so the second leg can put it back.
    const perAccountKey = await page.evaluate(() => {
      const composite = Object.keys(localStorage).find(
        (k) => k.startsWith('worktrac-appstate-') && !k.startsWith('worktrac-appstate-migrated:') && k.includes(':'),
      );
      if (!composite) return null;
      const perAccount = composite.slice(0, composite.lastIndexOf(':'));
      localStorage.setItem(perAccount, localStorage.getItem(composite));
      localStorage.removeItem(composite);
      Object.keys(localStorage)
        .filter((k) => k.startsWith('worktrac-appstate-migrated:'))
        .forEach((k) => localStorage.removeItem(k));
      return perAccount;
    });
    // If the app ever stops writing a per-login key this silently becomes a no-op test, so the
    // rewind asserts it actually found one.
    expect(perAccountKey, 'no per-login app-state key found to rewind').toBeTruthy();
    const legacyState = await page.evaluate((k) => localStorage.getItem(k), perAccountKey);

    // Leg 1 -- the owner boots and gets their own state back: Alex, not the primary they would
    // otherwise default to. The adoption also deletes the per-account key on its way through.
    await page.reload();
    await expect(personPill(page, 'Alex')).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page.evaluate((k) => localStorage.getItem(k), perAccountKey),
      'adoption should have removed the per-account key',
    ).toBeNull();

    // Leg 2 -- THE TOMBSTONE ITSELF. Put the shared key back, exactly as a failed delete during
    // adoption would have left it. Nothing but the tombstone now stands between the household's
    // old state and the next member to sign in.
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [perAccountKey, legacyState]);

    await logout(page);
    await loginAs(page, sam.email, sam.password);
    await expect(personPill(page, 'Sam')).toHaveAttribute('aria-pressed', 'true');
    await expect(personPill(page, 'Alex')).toHaveAttribute('aria-pressed', 'false');
  });

  // The app-state half. Lower stakes than the outbox -- it loses no data, it just shows the wrong
  // person's -- but the same sharing problem, and a member landing on a sibling's greyed-out screen
  // reads as the app being broken before it reads as read-only.
  test("a member never opens on the person the previous member was viewing", async ({ page, request }) => {
    const { sam, alex } = await household(page, request);

    // Sam parks on somebody ELSE -- Nate, visible read-only because members_see_everyone is forced
    // ON. That makes the persisted activePersonId a value neither AppShell's own default nor Alex's
    // membership could produce, so the assertion below can only be satisfied by the app-state key
    // actually being per-login.
    await loginAs(page, sam.email, sam.password);
    await personPill(page, 'Nate').click();
    await expect(personPill(page, 'Nate')).toHaveAttribute('aria-pressed', 'true');
    // The persister is throttled, so give the write a beat to reach localStorage before the logout.
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('worktrac-appstate-'))))
      .toBe(true);

    await logout(page);
    await loginAs(page, alex.email, alex.password);

    // Alex, not Nate. Under the account-only app-state key this restored Sam's activePersonId.
    await expect(personPill(page, 'Alex')).toHaveAttribute('aria-pressed', 'true');
    await expect(personPill(page, 'Nate')).toHaveAttribute('aria-pressed', 'false');
  });
});
