// The account the barrage runs against, its seed data, and cleaning up after a run.
//
// The account must be dedicated to testing. On lower it is a standing account seeded once with
// five years of daily History (`--seed`); on local a throwaway one is registered per run.
import { Api } from './api.mjs';
import { localTestSupportKey, log, sleep } from './config.mjs';

export const SEED_YEARS = 5;
export const MIN_SEEDED_WORKOUTS = 1500;
const EXERCISES = [
  ['Barbell Bench Press', 135], ['Barbell Back Squat', 185], ['Barbell Deadlift', 225], ['Pull-up', 0],
  ['Barbell Overhead Press', 95], ['Barbell Row', 135], ['Dumbbell Bicep Curl', 30], ['Leg Press', 270],
];

// Deterministic pseudo-random, so every seed is the same shape.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// One workout a day for `years` years up to yesterday: four exercises, three sets each.
export function seedCsvChunks(years = SEED_YEARS) {
  const random = rng(20260925);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  const chunks = new Map();
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const hour = [6, 7, 12, 17, 18][Math.floor(random() * 5)];
    const rows = chunks.get(day.slice(0, 4)) ?? [];
    const picked = [...EXERCISES].sort(() => random() - 0.5).slice(0, 4);
    for (const [name, base] of picked) {
      for (let set = 0; set < 3; set += 1) {
        const weight = base ? base + 5 * (Math.floor(random() * 11) - 4) : 0;
        rows.push(`${name},${day},${String(hour).padStart(2, '0')}:00:00,${weight},lb,${3 + Math.floor(random() * 10)}`);
      }
    }
    chunks.set(day.slice(0, 4), rows);
  }
  // Two years per import: imports are throttled per account (a handful per window), and two years
  // (~8,800 rows) stays well inside an import's 20,000-row / 5 MB limits.
  const calendarYears = [...chunks.keys()].sort();
  const out = [];
  for (let i = 0; i < calendarYears.length; i += 2) {
    const pair = calendarYears.slice(i, i + 2);
    const rows = pair.flatMap((y) => chunks.get(y));
    out.push({ year: pair.join('-'), csv: `Exercise,Date,Time,Weight,Unit,Reps\n${rows.join('\n')}\n` });
  }
  return out;
}

export async function seed(api) {
  for (const { year, csv } of seedCsvChunks()) {
    for (let attempt = 0; ; attempt += 1) {
      const r = await api.req('POST', `/api/people/${api.personId}/import`, { csv, filename: `barrage-${year}.csv` }, { timeoutMs: 600000 });
      if (r.status === 200) { log(`seeded ${year}: ${r.body.setCount} sets`); break; }
      if (r.status === 429 && attempt < 10) { log(`import rate-limited; waiting 60s (${year})`); await sleep(60000); continue; }
      throw new Error(`import ${year} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
  }
}

// A throwaway local account (test-support endpoint, the same one e2e registration uses), on Plus so
// the Free window hides nothing, seeded with the same five years.
export async function registerLocal(base) {
  const key = localTestSupportKey();
  const email = `huddle+e2e-barrage-${Date.now()}@starner.co`;
  const password = 'barrage-local-password-1';
  const anon = new Api(base, { testSupportKey: key });
  await anon.ok('POST', '/api/auth/register', { email, password, personName: 'Nate' });
  const { code } = await anon.ok('GET', `/api/auth/test/pending-code?email=${encodeURIComponent(email)}`);
  await anon.ok('POST', '/api/auth/confirm-email', { email, code });
  await anon.ok('POST', `/api/auth/test/billing-plan?email=${encodeURIComponent(email)}&plan=PLUS`);
  const api = await Api.login(base, email, password);
  await seed(api);
  return { email, password, api };
}

// Everything a run writes is removed at the end: sets created since the run started in the
// workouts it touched (and in any workout started since), people it added, and the live workout.
// Empty past workouts it created cannot be deleted (there is no endpoint); they hold no sets, so
// History never shows them.
export class Cleanup {
  constructor(api, runStartedAt) {
    this.api = api;
    this.runStartedAt = runStartedAt;
    this.sessions = new Set();
    this.people = new Set();
    this.exercises = new Set();
  }

  touch(sessionId) { if (sessionId != null) this.sessions.add(Number(sessionId)); }
  addPerson(id) { this.people.add(Number(id)); }
  addExercise(id) { this.exercises.add(Number(id)); }

  async run() {
    const since = this.runStartedAt.getTime();
    const at = (iso) => new Date(iso).getTime();
    let deleted = 0;
    const personIds = [this.api.personId, ...this.people];
    for (const personId of personIds) {
      const truth = await this.api.truth(personId).catch(() => []);
      for (const s of truth) {
        if (!this.sessions.has(s.id) && at(s.startedAt) < since && s.endedAt !== null) continue;
        for (const e of s.entries) {
          const sets = await this.api.setsOf(s.id, e.exerciseId).catch(() => []);
          for (const set of sets) {
            if (at(set.createdAt) >= since || at(s.startedAt) >= since) {
              const r = await this.api.req('DELETE', `/api/sets/${set.id}`);
              if (r.status === 204) deleted += 1;
            }
          }
        }
      }
    }
    for (const id of this.exercises) await this.api.req('DELETE', `/api/exercises/${id}`);
    for (const id of this.people) await this.api.req('DELETE', `/api/people/${id}`);
    await this.api.req('POST', `/api/people/${this.api.personId}/sessions/live/end`);
    // Any person a run added and failed to record, by name.
    const people = await this.api.ok('GET', '/api/people').catch(() => []);
    for (const p of people) if (/^Barrage /.test(p.name)) await this.api.req('DELETE', `/api/people/${p.id}`);
    const after = await this.api.truth().catch(() => null);
    return { deleted, workouts: after?.length ?? null, sets: after?.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.sets.length, 0), 0) ?? null };
  }
}
