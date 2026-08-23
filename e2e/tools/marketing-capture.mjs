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

// Which weekdays each week's sessions land on (0 = Monday). Written out rather than generated
// because the point is that it should NOT look generated: real training is 3 a week most of the
// time, 2 when life happens, 4 in a good stretch, 5 rarely -- and the days move around. A fixed
// Mon/Wed/Fri produced a consistency grid with three perfectly straight stripes and a workouts-
// per-week chart that was flat at 3, which read as fake at a glance.
const WEEK_DAYS = [
  [0, 2, 4],       // 3
  [1, 4],          // 2
  [0, 2, 3, 5],    // 4
  [1, 3, 5],       // 3
  [0, 2, 4],       // 3
  [0, 1, 3, 4, 6], // 5
  [2, 5],          // 2
  [0, 1, 3, 5],    // 4
  [1, 3, 4],       // 3
  [0, 2, 5],       // 3
  [1, 2, 4, 6],    // 4
  [0, 3],          // 2
  [1, 3, 5],       // 3
  [0, 2, 4, 5],    // 4
  [1, 2, 4],       // 3
];

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
// Monday of the current calendar week -- every session is placed relative to this.
const thisMonday = new Date(now);
thisMonday.setHours(0, 0, 0, 0);
thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));

let sets = 0;
let personIndex = -1;
for (const spec of PEOPLE) {
  personIndex++;
  const person = people.find((p) => p.name === spec.name);
  const lifts = spec.lifts.map((l) => ({ ...l, ex: findExercise(l.exercise) }));

  // Rotates across sessions rather than across weekdays, so every lift keeps a dense enough
  // line to chart even though the number of sessions per week now varies.
  let sessionIndex = 0;

  for (let week = 0; week < WEEKS; week++) {
    // Each person walks the pattern from a different starting point, so the three of them
    // don't light up identical squares -- without shifting weekdays, which would push a
    // Sunday session into the next calendar week and blur the counts.
    const days = WEEK_DAYS[(week + personIndex * 5) % WEEK_DAYS.length];

    for (let d = 0; d < days.length; d++) {
      // Anchor to the real Monday of that calendar week. Counting back in rolling 7-day
      // blocks from "now" does NOT line up with the Mon-Sun weeks the workouts-per-week chart
      // bins by, so sessions bled across boundaries and the intended 2/3/4/5 distribution
      // came out as a nearly flat 3-4.
      const weekMonday = new Date(thisMonday);
      weekMonday.setDate(thisMonday.getDate() - (WEEKS - 1 - week) * 7);
      const sessionDate = new Date(weekMonday);
      sessionDate.setDate(weekMonday.getDate() + days[d]);
      // Vary the hour so sessions don't all start on the same minute.
      sessionDate.setHours(17 + ((week + d) % 4), (d * 17) % 60, 0, 0);
      if (sessionDate.getTime() > now) continue;
      const startedAt = sessionDate.toISOString();

      const res = await api.post(`/api/people/${person.id}/sessions`, { startedAt });
      const session = await res.json();

      // Two lifts a session, rotating through the person's programme.
      const a = lifts[sessionIndex % lifts.length];
      const b = lifts[(sessionIndex + 1) % lifts.length];
      sessionIndex++;
      const todays = lifts.length > 1 ? [a, b] : [a];

      for (const lift of todays) {
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
