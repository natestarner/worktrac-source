// Creates a throwaway household on lower for the signed-in app flows (e2e/mobile/flows/), and hands
// its sign-in to Maestro through $GITHUB_ENV as MAESTRO_EMAIL / MAESTRO_PASSWORD.
//
// The same route the Playwright suite takes (tests/support/auth.ts's registerHousehold), minus the
// browser: register, read the code back from the profile-gated test-support endpoint, confirm.
// Confirming through the API rather than the app's own screen also means the first-run welcome
// modal is never armed (onboarding.md: only AuthContext.confirmEmail arms it), so the flows start
// on a plain Log screen.
//
// ⚠️ The `huddle+e2e-` prefix and `@starner.co` domain must not change: lower's
// TestDataCleanupService matches on them, and EmailService skips the real send for that prefix.
//
// Usage: API_URL=https://... E2E_TEST_SUPPORT_KEY=... node seed-household.mjs
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const apiUrl = process.env.API_URL;
const testKey = process.env.E2E_TEST_SUPPORT_KEY;
if (!apiUrl || !testKey) {
  console.error('API_URL and E2E_TEST_SUPPORT_KEY are both required.');
  process.exit(1);
}

const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
const email = `huddle+e2e-mobile-${Date.now()}-${suffix}@starner.co`;
const password = `mobile-${randomUUID()}`;
const personName = 'Alex';

// Lower scales to zero, and its ingress HOLDS the first connection ~35s while a replica starts
// (resilience.md, axis B), so every call gets a budget well past that.
async function call(method, path, body, headers = {}) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
}

const registered = await call('POST', '/api/auth/register', { email, password, personName });
if (!registered.ok) {
  console.error(`register failed: ${registered.status} ${await registered.text()}`);
  process.exit(1);
}

// The code is cached per backend instance and can take a moment to appear (auth.ts's
// fetchPendingCode retries for the same reason).
let code = null;
for (let attempt = 0; attempt < 15 && !code; attempt++) {
  const response = await call('GET', `/api/auth/test/pending-code?email=${encodeURIComponent(email)}`, null, {
    'X-E2E-Test-Key': testKey,
  });
  if (response.ok) code = (await response.json()).code;
  else await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!code) {
  console.error(`no pending code appeared for ${email}`);
  process.exit(1);
}

const confirmed = await call('POST', '/api/auth/confirm-email', { email, code });
if (!confirmed.ok) {
  console.error(`confirm-email failed: ${confirmed.status} ${await confirmed.text()}`);
  process.exit(1);
}

console.log(`Seeded ${email}`);
if (process.env.GITHUB_ENV) {
  // Masked before it is written anywhere a log could echo it.
  console.log(`::add-mask::${password}`);
  appendFileSync(
    process.env.GITHUB_ENV,
    `MAESTRO_EMAIL=${email}\nMAESTRO_PASSWORD=${password}\nMAESTRO_PERSON=${personName}\n`,
  );
}
