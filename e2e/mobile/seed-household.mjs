// Creates throwaway households on lower for the signed-in app flows (e2e/mobile/flows/), ONE PER
// FLOW, and hands their sign-ins to Maestro through $GITHUB_ENV as MAESTRO_EMAIL_1..N (all sharing
// MAESTRO_PASSWORD and MAESTRO_PERSON). Each flow signs in as its own household so nothing one flow
// logs can change what another sees: Maestro promises no order, and the first version shared one
// household, so a flow's "the Barbell Bench Press on screen" pointed at the previous flow's session.
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
// Usage: API_URL=https://... E2E_TEST_SUPPORT_KEY=... SEED_COUNT=6 node seed-household.mjs
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const apiUrl = process.env.API_URL;
const testKey = process.env.E2E_TEST_SUPPORT_KEY;
const count = Number(process.env.SEED_COUNT ?? 1);
if (!apiUrl || !testKey) {
  console.error('API_URL and E2E_TEST_SUPPORT_KEY are both required.');
  process.exit(1);
}

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

async function seedOne() {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const email = `huddle+e2e-mobile-${Date.now()}-${suffix}@starner.co`;

  const registered = await call('POST', '/api/auth/register', { email, password, personName });
  if (!registered.ok) throw new Error(`register failed: ${registered.status} ${await registered.text()}`);

  // The code lives in memory on the backend instance that handled the register (TestCodeCache),
  // and can take a moment to appear, so this retries. A wrong key also 404s, deliberately, so the
  // endpoint can't be probed: 60 straight 404s with lower otherwise healthy means the key here
  // differs from the backend's (native-apps.md, how the key is rotated), not a slow cache.
  let code = null;
  let lastStatus = null;
  for (let attempt = 0; attempt < 60 && !code; attempt++) {
    const response = await call('GET', `/api/auth/test/pending-code?email=${encodeURIComponent(email)}`, null, {
      'X-E2E-Test-Key': testKey,
    });
    lastStatus = response.status;
    if (response.ok) code = (await response.json()).code;
    else await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!code) throw new Error(`no pending code for ${email} after 60 tries (last status ${lastStatus})`);

  const confirmed = await call('POST', '/api/auth/confirm-email', { email, code });
  if (!confirmed.ok) throw new Error(`confirm-email failed: ${confirmed.status} ${await confirmed.text()}`);
  return email;
}

const lines = [];
try {
  for (let i = 1; i <= count; i++) {
    const email = await seedOne();
    console.log(`Seeded ${i}: ${email}`);
    lines.push(`MAESTRO_EMAIL_${i}=${email}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (process.env.GITHUB_ENV) {
  // Masked before it is written anywhere a log could echo it.
  console.log(`::add-mask::${password}`);
  appendFileSync(
    process.env.GITHUB_ENV,
    `${lines.join('\n')}\nMAESTRO_PASSWORD=${password}\nMAESTRO_PERSON=${personName}\n`,
  );
}
