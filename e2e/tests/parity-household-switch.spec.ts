import { expect, type Page } from '@playwright/test';
import { addMemberLogin, registerHousehold } from './support/auth';
import { pickExercise } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';

const EXERCISE = 'Barbell Bench Press';
const ROW_LABEL = '0 lb × 8';

/**
 * ⚠️ THE SWITCH ITSELF IS NOT WHAT IS UNDER TEST HERE, AND IT CANNOT BE.
 *
 * The plan asked for a parity test over "switch → log a set → switch back" across all four
 * connectivity modes. Switching household **mints a session token**, so it genuinely requires the
 * network — there is no offline equivalent, and asserting that it "behaves the same in every mode"
 * would be asserting something false. It is a Tier-3, online-only action like `createPastSession`,
 * and it is recorded as such on the register in `.claude/rules/resilience.md` rather than
 * parity-tested.
 *
 * So the switch happens online in `setup`, and the parity claim is about logging afterwards: a set
 * logged in a household you switched INTO is optimistic, on screen, and eventually on the server,
 * whatever the connectivity. Nothing else in the suite covers that.
 *
 * ⚠️ WHAT THIS SPEC DOES **NOT** GUARD, measured rather than assumed: the outbox re-scoping itself.
 * Disabling `adoptOutboxScope` outright leaves all four modes here GREEN, because the queued write
 * replays out of the in-memory mutation cache on reconnect and the persisted scope key is never
 * consulted — nothing in this flow crosses a document boundary, which is the only place that key
 * bites. An earlier draft of this comment claimed the re-scoping as its subject; that was wrong.
 *
 * The real guard is `household-switch.spec.ts`'s "queued work waits for the household it belongs
 * to", which switches AWAY and BACK: that evicts the mutation cache and forces the return trip to
 * restore from disk. Verified non-vacuous — with `adoptOutboxScope` disabled it fails on exactly
 * the right assertion, household B inheriting household A's queued write.
 *
 * Same shape as the tombstone lesson in `feedback_verify_dont_assume`: when two mechanisms can
 * satisfy an assertion, disabling one proves nothing while the other still holds.
 */

// Same reasoning as parity-first-set: the picker filters CLIENT-SIDE over the single `exercises`
// query, so a mode entered before the boot warm finished leaves it permanently empty. Pay that
// online and explicitly, or the spec measures the warm race instead of the flow.
async function warmCatalog(page: Page) {
  const search = page.getByPlaceholder('Search all exercises');
  await search.fill(EXERCISE);
  await expect(page.getByRole('button', { name: EXERCISE, exact: true })).toBeVisible();
  await search.fill('');
}

async function openAccountMenu(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
}

async function logout(page: Page) {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login/);
}

forEachConnectivityMode<void>('a set logged after switching household behaves the same in every mode', {
  setup: async (page, request) => {
    // One credential in two households: register A, then attach that same email to B as a member.
    const sharedEmail = await registerHousehold(page, request, 'Alex');
    await logout(page);

    const otherOwnerEmail = await registerHousehold(page, request, 'Robin');
    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sam', exact: true }).first()).toBeVisible();
    await addMemberLogin(page, request, otherOwnerEmail, 'Sam', sharedEmail);
    await logout(page);

    // Sign in, take household A from the picker, then SWITCH to B -- online, deliberately.
    await page.goto('/login');
    await page.getByPlaceholder('Email', { exact: true }).fill(sharedEmail);
    await page.getByPlaceholder('Password', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('button', { name: /you own this/ }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: /^Switch to / }).click();
    // Household B's own person, which household A does not have -- proof the switch landed before
    // anything below runs in a degraded mode.
    await expect(page.locator('.app-chrome').getByRole('button', { name: 'Sam', exact: true }))
      .toBeVisible();

    await warmCatalog(page);
  },
  navigate: async (page) => {
    await pickExercise(page, EXERCISE);
  },
  act: async (page) => {
    await page.getByRole('button', { name: /^Log set/ }).click();
  },
  // The parity claim. No branch on ctx.mode: the row is on screen in every mode, because a durable
  // write is optimistic whether or not it can reach the server.
  assert: async (page) => {
    await expect(page.getByText('Set 1', { exact: true })).toHaveCount(1);
    await expect(page.getByText(ROW_LABEL, { exact: true })).toBeVisible();
  },
  // The half `assert` cannot see while degraded: it actually reached the server, in the household
  // that was switched INTO -- not stranded on screen, and not filed against household A. (It does
  // NOT prove the persisted scope key is right; see the header for why, and where that is proven.)
  afterReconnect: async (page) => {
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText(EXERCISE, { exact: true }).first()).toBeVisible();
  },
});
