#!/usr/bin/env node
// Seeds THIS worktree's local backend with a standing test household so local testing never
// starts from a blank slate. Run by `/run-local` after both servers answer healthy.
//
// - Registers nate@starner.co (bypassing the real inbox via TestSupportController, the same
//   mechanism e2e/tests/support/auth.ts uses) ONLY if it doesn't already exist.
// - Grants Pro via the same test-only escape hatch billing e2e specs use (no Stripe involved).
// - Imports several weeks of synthetic history through the real CSV import endpoint -- the same
//   path a person uses from App Settings -- ONLY on the run that just created the account.
//
// Import is deliberately gated to "just registered", not run on every invocation. The generated
// CSV's dates are relative to "today", so importing it again on a LATER calendar day would submit
// a different set of timestamps and add a second batch of history rather than being the no-op a
// re-import of an unchanged file is (CsvImportControllerTest's
// "reimportingTheSameFileIntoTheSamePersonAddsNothing" only holds for byte-identical content).
// The local database persists across `up.sh` restarts -- only the backend/frontend PROCESSES
// restart -- so what got imported once is still there; nothing here needs to run twice.
//
// Never fatal to `/run-local`: this is a convenience, not a requirement for the app to be usable,
// so every failure is a warning on stderr and the script exits 0 regardless.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, '..');

const EMAIL = 'nate@starner.co';
const PASSWORD = 'password'; // Local-only, never leaves this machine. Meets the 8-char minimum exactly.
const PERSON_NAME = 'Nate';
// Matches application-local.yml's committed default. A committed placeholder is safe here for the
// same reason jwt.secret and test-support-key are: it only gates a route that doesn't exist
// outside local/lower, on a server nothing external can reach.
const TEST_KEY = process.env.E2E_TEST_SUPPORT_KEY || 'local-dev-only-e2e-test-key-do-not-use-elsewhere';

function backendPort() {
  const envFile = path.join(REPO_ROOT, '.env.worktree');
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, 'utf8').match(/^BACKEND_PORT=(\d+)/m);
    if (match) return match[1];
  }
  // No .env.worktree means the primary `main` checkout (worktree-env.sh never writes one there).
  return '8080';
}

const BASE = `http://localhost:${backendPort()}`;

async function json(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) return null;
  return json(response);
}

async function fetchPendingCode() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${BASE}/api/auth/test/pending-code?email=${encodeURIComponent(EMAIL)}`,
      { headers: { 'X-E2E-Test-Key': TEST_KEY } },
    );
    if (response.ok) {
      const body = await json(response);
      if (body?.code) return body.code;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('No pending confirmation code appeared -- is the backend profile "local"?');
}

async function registerAndConfirm() {
  const registerResponse = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountName: "Nate's Household",
      email: EMAIL,
      password: PASSWORD,
      personName: PERSON_NAME,
    }),
  });
  if (!registerResponse.ok) {
    throw new Error(`Registration failed: ${registerResponse.status} ${await registerResponse.text()}`);
  }

  const code = await fetchPendingCode();
  const confirmResponse = await fetch(`${BASE}/api/auth/confirm-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, code }),
  });
  if (!confirmResponse.ok) {
    throw new Error(`Confirming email failed: ${confirmResponse.status} ${await confirmResponse.text()}`);
  }
  return json(confirmResponse);
}

async function grantPro() {
  const response = await fetch(
    `${BASE}/api/auth/test/billing-plan?email=${encodeURIComponent(EMAIL)}&plan=PRO`,
    { method: 'POST', headers: { 'X-E2E-Test-Key': TEST_KEY } },
  );
  if (!response.ok) {
    throw new Error(`Granting Pro failed: ${response.status} ${await response.text()}`);
  }
}

// 8 weeks, 3 sessions/week, most recent session dated today -- so whatever screen you open shows
// something recent rather than a wall of "3 months ago". Weight/reps/hold time all progress
// session over session so Trends has a real line to draw, not a flat one.
function buildHistoryCsv() {
  const WEEKS = 8;
  const SESSIONS_PER_WEEK = 3;
  const TOTAL = WEEKS * SESSIONS_PER_WEEK;
  const today = new Date();

  const rows = ['Exercise,Date,Time,Weight,Unit,Reps,Duration (sec)'];

  for (let i = 0; i < TOTAL; i++) {
    // i=0 is the OLDEST session (most days ago); i=TOTAL-1 lands on today.
    const daysAgo = (TOTAL - 1 - i) * 2; // every other day, 46 days of span across 24 sessions.
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = date.toISOString().slice(0, 10);

    const benchWeight = 135 + i * 2.5;
    const squatWeight = 185 + i * 5;
    const pullupReps = 5 + Math.floor(i / 4);
    const plankSeconds = 30 + i * 3;

    let minute = 0;
    const nextTime = (hour, incr) => {
      const t = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
      minute += incr;
      return t;
    };

    minute = 0;
    for (const reps of [8, 6, 5]) {
      rows.push(`Barbell Bench Press,${dateStr},${nextTime(18, 3)},${benchWeight},lb,${reps},`);
    }
    minute = 15;
    for (const reps of [8, 6, 5]) {
      rows.push(`Back Squat,${dateStr},${nextTime(18, 3)},${squatWeight},lb,${reps},`);
    }
    minute = 35;
    for (let s = 0; s < 3; s++) {
      rows.push(`Pull-Up,${dateStr},${nextTime(18, 2)},,,${pullupReps},`);
    }
    rows.push(`Plank,${dateStr},18:50:00,,,,${plankSeconds}`);
  }

  return rows.join('\n') + '\n';
}

async function importHistory(token, personId) {
  const csv = buildHistoryCsv();
  const response = await fetch(`${BASE}/api/people/${personId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ csv, filename: 'seed-history.csv' }),
  });
  if (!response.ok) {
    throw new Error(`Import failed: ${response.status} ${await response.text()}`);
  }
  return json(response);
}

async function main() {
  console.log(`Seeding local test household (${EMAIL}) on ${BASE}...`);

  const existing = await login();
  if (existing) {
    console.log('  Already registered -- ensuring Pro and leaving existing history as-is.');
    await grantPro();
    console.log(`  Ready. Log in locally with ${EMAIL} / ${PASSWORD}.`);
    return;
  }

  console.log('  Registering...');
  const auth = await registerAndConfirm();
  await grantPro();

  console.log('  Importing ~8 weeks of history...');
  const result = await importHistory(auth.token, auth.person.id);
  console.log(
    `  Imported ${result.setCount} sets across ${result.sessionCount} sessions ` +
      `(${result.newExerciseNames.length} exercises created).`,
  );
  console.log(`  Ready. Log in locally with ${EMAIL} / ${PASSWORD}.`);
}

main().catch((err) => {
  console.warn(`seed-local-account.mjs: skipping seed data -- ${err.message}`);
});
