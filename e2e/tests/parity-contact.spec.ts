import { expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { forEachConnectivityMode } from './support/parity';

// WHAT IS AND ISN'T A PARITY CLAIM HERE.
//
// Sending is a Tier-3 gated write: it legitimately REFUSES offline, so "the submit succeeds" is
// not a mode-independent result and asserting it across modes would be asserting the opposite of
// the register's sanctioned divergence. The gating itself is covered conventionally in
// contact.spec.ts, in the offline-gating.spec.ts idiom.
//
// What genuinely must not vary is everything up to the send: reaching the form from the profile
// dropdown, the form rendering with its fields, and a draft written earlier still being there.
// That last one is the load-bearing half -- it is the entire reason refusing offline is acceptable
// rather than lossy. If the draft only survived online, a person would type a bug report during
// the exact outage they were writing about and lose it.
//
// Verified non-vacuous: dropping `contactDraft` from PERSON_DEFAULTS (so a restored slice hydrates
// it as undefined) fails the draft assertion in every mode; making ContactTab hold the draft in
// plain useState fails it after the Back/return navigation in every mode.

const SUBJECT = 'Written before the outage';
const DETAILS = 'This text was typed before anything went wrong, and must still be here.';

forEachConnectivityMode<void>('the contact form is reachable and keeps its draft', {
  setup: async (page, request) => {
    await registerHousehold(page, request, 'Ferreira');

    // Seed the draft ONLINE, before the mode is entered, so what each mode exercises is whether a
    // persisted draft comes back -- not whether it can be typed under that mode.
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Contact Us' }).click();
    await page.getByLabel('Subject').fill(SUBJECT);
    await page.getByLabel('Details').fill(DETAILS);

    // Back to Log, which is where the harness normalises every mode to anyway.
    await page.getByRole('button', { name: '← Back' }).click();
  },
  // The action under test IS the navigation -- opening Contact Us from the profile dropdown -- so
  // it belongs in `act` rather than `navigate`.
  act: async (page) => {
    await page.locator('.header-bar').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Contact Us' }).click();
  },
  assert: async (page) => {
    // Mode-independent, all of it: the page renders from cached app state and reads nothing from
    // the network, so there is no legitimate reason for any of this to differ by connectivity.
    await expect(page).toHaveURL(/\/app\/contact/);
    await expect(page.getByLabel('Subject')).toHaveValue(SUBJECT);
    await expect(page.getByLabel('Details')).toHaveValue(DETAILS);
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  },
});
