import { test, expect } from '@playwright/test';
import { registerHousehold, fetchEmailOutcome } from './support/auth';

// The one deliberate exception to every other spec's e2e-noop'd registration email: every other
// spec's "huddle+e2e-..." address matches EmailProperties.e2eNoopRecipientPattern, so
// EmailService skips the real Azure Communication Services call entirely for it (see
// EmailService.isE2eNoopRecipient) -- necessary to stop the suite from generating ~128 real
// sends per run, but it also means those specs can no longer prove the real registration ->
// email pipeline still works end to end. This spec's address ("huddle+livewiretest-...",
// deliberately NOT matching the "huddle+e2e-" no-op prefix) always triggers a real send, so this
// is the one test that would actually fail if the live ACS integration broke -- exactly the
// failure mode (a verification email silently never sent) that motivated the whole registration
// audit trail this test reads from.
//
// A timestamp+random suffix (not a single fixed address) avoids "email already registered"
// collisions across repeated runs -- same reasoning as the regular e2e pattern in auth.ts.
test.describe('Live email canary', () => {
  test('a real registration triggers a real, successfully-accepted ACS send', async ({ page, request }) => {
    const email = `huddle+livewiretest-${Date.now()}-${Math.random().toString(16).slice(2)}@starner.co`;

    await registerHousehold(page, request, 'Canary', email);

    const configResponse = await request.get('/config.json');
    const { apiUrl } = await configResponse.json();
    const outcome = await fetchEmailOutcome(request, apiUrl, email);

    expect(outcome.status, `expected a real ACS send to succeed, but got: ${outcome.detail}`).toBe('SENT');
    expect(outcome.messageId).toBeTruthy();
    // A no-op'd send's synthetic messageId is always prefixed "noop-" (see EmailService) -- this
    // address must never match the no-op pattern, so asserting its absence here would catch a
    // future accidental broadening of that pattern to include "livewiretest" too.
    expect(outcome.messageId).not.toMatch(/^noop-/);
  });
});
