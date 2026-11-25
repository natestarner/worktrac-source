import { expect, Page, test } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { dismissPrCelebration, pickExercise, prCelebration, setStepperPair } from './support/exercises';
import { forEachConnectivityMode } from './support/parity';
import { addPerson } from './support/people';

// THE QUIET FIRST-TIME CARD. A 2026-11-24 walk-through as a brand-new person popped the full-screen
// "New PR!" on 5 of their first 6 sets. The very first set of an exercise is a starting mark, not a
// record, so it now gets the SAME card made quieter: "First Barbell Bench Press", one "Your starting
// mark" row, no confetti. Anything that beats it -- even later in the same workout -- is a full
// "New PR!".
//
// Nate's hard rule is that an actual PR is NEVER missed, so the quiet card needs the server to have
// confirmed "never logged" (prDetection.js#isCertainFirstEver). The server reads full history even on
// Free; the device does not. Unconfirmed -- offline, lie-fi -- a first set gets the full "New PR!",
// as it did before. That divergence is on the register in .claude/rules/resilience.md; the parity
// block below pins what must NOT diverge.

// The summary request for the exercise about to be opened. The quiet card is only shown once it has
// answered, and a spec that taps "Log set" before then gets "New PR!" -- correct, but not what these
// tests are about. A real person takes longer than a round trip to set the weight.
function summaryAnswered(page: Page) {
  return page.waitForResponse((r) => /\/exercises\/[^/]+\/summary/.test(r.url()) && r.ok());
}

async function logAt(page: Page, weight: number, reps: number) {
  await setStepperPair(page, weight, reps);
  await page.getByRole('button', { name: /^Log set/ }).click();
}

test.describe('First-time celebration', () => {
  test('a first-ever set gets the quiet card, and beating it is a full New PR!', { tag: '@critical' }, async ({ page, request }) => {
    await registerHousehold(page, request, 'Rowan');
    const answered = summaryAnswered(page);
    await pickExercise(page, 'Barbell Bench Press');
    await answered;

    await logAt(page, 135, 8);

    const first = page.getByRole('dialog', { name: 'First Barbell Bench Press' });
    await expect(first).toBeVisible();
    await expect(first).toContainText('135 lb × 8');
    await expect(first).toContainText('Your starting mark');
    await expect(first).toContainText('Beat it and it’s a new PR.');
    // A starting mark claims no record.
    await expect(page.getByText('New PR!')).toHaveCount(0);
    await expect(first).not.toContainText('Top weight');
    await expect(first).not.toContainText('Est. 1RM');
    await first.getByRole('button', { name: 'Nice' }).click();
    await expect(first).toBeHidden();

    // Same workout, minutes later: beating the starting mark is a real record, celebrated in full.
    await logAt(page, 155, 6);
    await expect(page.getByText('New PR!')).toBeVisible();
    await expect(prCelebration(page)).toContainText('Top weight');
    await prCelebration(page).getByRole('button', { name: 'Nice' }).click();
    await expect(prCelebration(page)).toBeHidden();

    // And a set that beats nothing raises nothing.
    await logAt(page, 125, 8);
    await expect(page.getByText(/^Set 3$/)).toBeVisible();
    await expect(prCelebration(page)).toHaveCount(0);
  });

  test("names the person in a household of two: \"Sam's first …\"", async ({ page, request }) => {
    await registerHousehold(page, request, 'Nate');
    await addPerson(page, 'Sam');
    await page.locator('.person-pill-bar').getByRole('button', { name: /Sam/ }).click();
    const answered = summaryAnswered(page);
    await pickExercise(page, 'Plank');
    await answered;

    await page.getByRole('button', { name: /^Log set/ }).click();

    const first = page.getByRole('dialog', { name: 'Sam’s first Plank' });
    await expect(first).toBeVisible();
    await expect(first).toContainText('Your starting mark');
    await first.click({ force: true }); // a tap anywhere dismisses, as on every celebration
    await expect(first).toBeHidden();
  });

  // ⚠️ THE CASE THE SAFETY RULE EXISTS FOR. A Free household's device holds 90 days of History, so
  // a bench press logged 200 days ago is invisible to it -- but not to the server's summary. That is
  // a second workout, never a "first": the set that does not beat it raises nothing, and the set
  // that does is a full "New PR!". Deliberately Free (no setBillingPlan): the clamp is the subject.
  test('an exercise last logged outside the Free window is never called a first', async ({ page, request }) => {
    await registerHousehold(page, request, 'Wren');

    const d = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const outOfWindow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Log a past workout' }).click();
    const modal = page.getByRole('dialog');
    await modal.locator('input[type="date"]').fill(outOfWindow);
    await modal.locator('input[type="time"]').fill('09:00');
    await modal.getByRole('button', { name: 'Start adding sets' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await pickExercise(page, 'Barbell Bench Press');
    await logAt(page, 135, 8);
    await expect(page.getByText(/^Set 1$/)).toBeVisible();
    await dismissPrCelebration(page);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/app\/history/);
    // The clamp really is hiding it -- otherwise this test proves nothing about Free.
    await expect(page.getByText(/Your full history has 1 more workout\./)).toBeVisible();

    await page.getByRole('link', { name: 'Log' }).click();
    const answered = summaryAnswered(page);
    await pickExercise(page, 'Barbell Bench Press');
    await answered;

    await logAt(page, 125, 8);
    await expect(page.getByText(/^Set 1$/)).toBeVisible();
    await expect(prCelebration(page)).toHaveCount(0);

    await logAt(page, 155, 6);
    await expect(page.getByText('New PR!')).toBeVisible();
    await expect(page.getByRole('dialog', { name: /first/i })).toHaveCount(0);
  });
});

// What must NOT diverge across modes: a first-ever set is always celebrated with a card naming the
// set, and the next set that beats it is always a full "New PR!" -- never swallowed as a second
// "first" because the server could not be asked. (Which headline the FIRST card carries is the
// registered divergence, so the assertion accepts either; it never branches on the mode.)
//
// VERIFIED NOT VACUOUS (2026-11-24): with isCertainFirstEver returning `true`, every mode fails --
// set 2 reads as another "first". Note set 2 is protected twice, which is why a subtler break is
// NOT enough to turn this red: set 1 is folded into the local priors, AND once it is logged the
// summary is re-asked under the new session id (pending -> unconfirmed) and answers with set 1 in
// it. Dropping either one alone leaves this green. The quiet card itself is pinned by the tests
// above, which fail with isCertainFirstEver returning `false` (the pre-change behaviour).
forEachConnectivityMode<{ personName: string }>('a first set is celebrated, and beating it is a New PR!', {
  setup: async (page, request) => {
    const personName = 'Ember';
    await registerHousehold(page, request, personName);
    return { personName };
  },

  navigate: async (page) => {
    await pickExercise(page, 'Barbell Bench Press');
  },

  act: async (page) => {
    await logAt(page, 135, 8);
  },

  assert: async (page) => {
    const card = prCelebration(page);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Barbell Bench Press');
    await expect(card).toContainText('135 lb × 8');
    await card.getByRole('button', { name: 'Nice' }).click();
    await expect(card).toBeHidden();

    await logAt(page, 155, 6);
    await expect(page.getByText('New PR!')).toBeVisible();
    await expect(card).toContainText('Top weight');
    await card.getByRole('button', { name: 'Nice' }).click();
    await expect(card).toBeHidden();
  },

  afterReconnect: async (page) => {
    await page.getByRole('link', { name: 'PRs' }).click();
    await expect(page.getByTestId('pr-row').filter({ hasText: 'Barbell Bench Press' })).toBeVisible();
  },
});
