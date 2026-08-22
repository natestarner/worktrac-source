/* Seed a realistic household into the LOCAL stack and screenshot the real app for the
 * marketing site.
 *
 * Everything the landing page shows is a genuine render of the running app -- no mockups.
 * Seeding goes through the real API with the real JWT, then the app is loaded fresh so the
 * offline cache warms against populated data (warming it first leaves sections blank for a
 * minute; that has bitten before).
 *
 * Usage, with this worktree's stack already up (bash scripts/up.sh):
 *   cd e2e
 *   FRONTEND=http://localhost:3003 node tools/marketing-capture.mjs ../marketing/assets/shots
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const FRONTEND = process.env.FRONTEND || 'http://localhost:3003';
const OUT = process.argv[2] || './shots';
const TEST_KEY = process.env.E2E_TEST_SUPPORT_KEY || 'local-dev-only-e2e-test-key-do-not-use-elsewhere';

mkdirSync(OUT, { recursive: true });

const DAY = 86_400_000;
const now = Date.now();

// A household that reads like a real one: a parent and two sons, each on their own
// programme, each at a different level. Numbers progress the way real training does --
// mostly up, with a stall week and a deload, because a perfectly straight line looks fake.
const PEOPLE = [
  {
    name: 'Nate',
    lifts: [
      { exercise: 'Barbell Bench Press', start: 135, gain: 2.5, reps: [8, 8, 6] },
      { exercise: 'Barbell Back Squat', start: 185, gain: 5, reps: [5, 5, 5] },
      { exercise: 'Barbell Deadlift', start: 225, gain: 5, reps: [5, 3, 3] },
      { exercise: 'Overhead Press', start: 85, gain: 1.5, reps: [8, 6, 6] },
    ],
  },
  {
    name: 'Miles',
    lifts: [
      { exercise: 'Barbell Bench Press', start: 95, gain: 2.5, reps: [8, 8, 7] },
      { exercise: 'Barbell Back Squat', start: 115, gain: 5, reps: [8, 6, 6] },
      { exercise: 'Overhead Press', start: 55, gain: 1.5, reps: [8, 8, 6] },
    ],
  },
  {
    name: 'Eli',
    lifts: [
      { exercise: 'Barbell Bench Press', start: 65, gain: 2.5, reps: [10, 8, 8] },
      { exercise: 'Barbell Back Squat', start: 85, gain: 5, reps: [10, 8, 8] },
    ],
  },
];

const WEEKS = 15;
const SESSION_DAYS = [0, 2, 4]; // Mon / Wed / Fri

function weightFor(lift, week) {
  // Stall at week 8, deload at 11 -- real progression is not a ramp.
  let effective = week;
  if (week >= 8) effective = week - 1;
  if (week >= 11) effective = week - 2;
  const w = lift.start + effective * lift.gain;
  return Math.round(w * 2) / 2;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// ---------------------------------------------------------------- register
const email = `huddle+e2e-shots-${Date.now()}@starner.co`;
await page.goto(`${FRONTEND}/register`);
await page.getByPlaceholder('e.g. Alex').fill('Nate');
await page.getByPlaceholder('you@example.com').fill(email);
await page.getByPlaceholder('At least 8 characters').fill('password123');
await page.getByRole('button', { name: 'Create household' }).click();
await page.waitForURL(/\/confirm-email/);

const { apiUrl: rawApi } = await (await ctx.request.get(`${FRONTEND}/config.json`)).json();
const API = rawApi || FRONTEND;

const codeRes = await ctx.request.get(`${API}/api/auth/test/pending-code`, {
  params: { email },
  headers: { 'X-E2E-Test-Key': TEST_KEY },
});
const { code } = await codeRes.json();
await page.getByPlaceholder('123456').fill(code);
await page.getByRole('button', { name: 'Confirm' }).click();
await page.waitForURL(/\/app\/log/);

const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = {
  get: (p) => ctx.request.get(`${API}${p}`, { headers: H }).then((r) => r.json()),
  post: (p, data) => ctx.request.post(`${API}${p}`, { headers: H, data }),
};

console.log('registered', email);

// ---------------------------------------------------------------- people + exercises
for (const p of PEOPLE.slice(1)) await api.post('/api/people', { name: p.name });
const people = await api.get('/api/people');
console.log('people:', people.map((p) => p.name).join(', '));

const catalog = await api.get('/api/exercises');
const byName = new Map(catalog.map((e) => [e.name.toLowerCase(), e]));
function findExercise(name) {
  const hit = byName.get(name.toLowerCase());
  if (hit) return hit;
  // Fall back to a loose match so a renamed catalog entry doesn't kill the run.
  for (const [k, v] of byName) if (k.includes(name.toLowerCase().split(' ').pop())) return v;
  throw new Error(`No catalog exercise matching "${name}"`);
}

// ---------------------------------------------------------------- seed history
let sets = 0;
for (const spec of PEOPLE) {
  const person = people.find((p) => p.name === spec.name);
  const lifts = spec.lifts.map((l) => ({ ...l, ex: findExercise(l.exercise) }));

  for (let week = 0; week < WEEKS; week++) {
    for (let d = 0; d < SESSION_DAYS.length; d++) {
      const daysAgo = (WEEKS - 1 - week) * 7 + (6 - SESSION_DAYS[d]);
      if (daysAgo < 0) continue;
      const startedAt = new Date(now - daysAgo * DAY - 18 * 3600_000).toISOString();

      const res = await api.post(`/api/people/${person.id}/sessions`, { startedAt });
      const session = await res.json();

      // Two lifts a session, rotating, so each has a dense-enough line to chart.
      const todays = lifts.filter((_, i) => i % SESSION_DAYS.length === d % SESSION_DAYS.length);
      for (const lift of todays.length ? todays : [lifts[0]]) {
        const w = weightFor(lift, week);
        for (let s = 0; s < lift.reps.length; s++) {
          await api.post(`/api/sessions/${session.id}/sets`, {
            exerciseId: lift.ex.id,
            weight: w,
            reps: lift.reps[s],
            idempotencyKey: `shots-${person.id}-${week}-${d}-${lift.ex.id}-${s}`,
            clientLoggedAt: new Date(new Date(startedAt).getTime() + s * 180_000).toISOString(),
          });
          sets++;
        }
      }
    }
  }
  console.log(`seeded ${spec.name}`);
}
console.log(`${sets} sets seeded`);

await browser.close();
console.log('\nSeeded. Household login:');
console.log(`  ${email} / password123`);
console.log(`  ${FRONTEND}/login`);
