# PRs and Trends from History

The PRs board and Trends are computed on the server by `StatsService`, which loads every set the
person has ever logged on each request. The device already holds that same History, kept current a
month at a time by fingerprint (`history-sync.md`). This page records the plan to derive both screens
from it, and the baseline measured before anything changed — the History refactor's lesson was to
measure first, on lower, and to prove equivalence before switching a screen.

## Baseline (2026-09-28)

A five-year History: 1,827 workouts, ~21,900 sets, the barrage account's shape.

### Lower (`node e2e/barrage/barrage.mjs --target lower --suites api:bench`)

| Request | median | body |
|---|---:|---:|
| `GET /prs` | **3,596 ms** | 8.9 KB |
| `GET /trends/overview` (12wk or All) | **3,549–3,627 ms** | 11–40 KB |
| `GET /trends/exercises/{id}` (12wk / All) | 371–388 ms | 12.5 / 261 KB |
| `GET /exercises/{id}/records` | 364 ms | 0.7 KB |
| `GET /exercises/{id}/summary` | 343 ms | 0.9 KB |
| History full sync (the whole History) | 2,849 ms | — |
| History "nothing changed" check | 785 ms | — |
| History scoped sync after a set | 340 ms | — |

Opening PRs costs more than downloading the person's entire History, and every Trends range
change pays the same again. The database peaked at 89% CPU over the three-minute bench.

**Where the 3.6s goes (lower's Query Store).** The ARM `topQueries` API returns only the top five
statements by CPU per hour, and only once the hour has closed, so the statement was identified by a
burst of distinctive counts: 37 whole-person loads (15 from the bench, 22 more `/prs`) and 53
per-exercise loads in the 18:00 UTC hour. Query 1786 ran **42 times at 2,881 ms of database time
each** (the five extra are most likely an app session on the account) — about 2.9s of the 3.6s is
the database; the rest is hydrating ~22k entities. The per-exercise statement never reached the top
five: cheap on the database, so its ~350ms is mostly round trip and application time.

The same statement runs ~1,000 times an hour during lower's e2e runs at under a millisecond each:
for a tiny household it is cheap on lower, unlike the probe's local plan below (3,000 reads). The
cost follows a person's years of History.

**Production today is not where it hurts.** Its busiest statements over the same day ran at 1–3 ms
each; real households' Histories are still young. Like History before it, this is a growth problem:
the cost reaches ~2.9s of database time per call at five years, paid on every app open by the warm.

### Plan shape at lower's proportions (`StatsCostProbe`)

`mvn test -Dtest=StatsCostProbe -Dstats.probe=true` seeds lower's proportions (302k workouts,
1.2M sets, 40k exercises, with the five-year person a sliver of them), runs a one-workout household
first, then reads each request's statements back from Query Store. Page reads are 8 KB logical reads.

| Request | 5-year person | 1-workout household | How it reads |
|---|---:|---:|---|
| `/prs`, `/trends/overview` | 17,200 | 3,000 | **clustered scans of `workout_sets` and `workout_sessions`** |
| `/trends/exercises/{id}`, `/records`, `/summary` | 5,900 | 3,000 | seek on (person, exercise), a key lookup per set |
| History full sync | 6,800 | 10 | seeks only |
| History "nothing changed" | 11,550 | 51 | seeks only |
| History scoped sync | 355 | 43 | seeks only |

The whole-person load (`findByPerson_IdOrderByCreatedAtAscIdAsc`, an entity load) reads
`rest_seconds`, `client_key` and `import_batch_id`, which no index covers, so SQL Server scans both
tables — the shape of round one of `docs/incidents/2026-09-25-history-full-sync-pegged-lower-db.md`.
Locally the one-workout household scanned too; lower's cached plan for tiny households does not
(above), so the plan chosen differs between the two, and lower's plan for the five-year person
cannot be read from here. What both agree on is that the load reads the person's whole History
every call. `/prs` also looks each exercise
up separately (one query per exercise). Locally, where the tables are small, `/prs` still took
775 ms against 443 ms for a full History sync, so hydrating ~22k entities is a cost of its own.

### Requests per everyday flow (`compare`, local)

| Flow | PRs / Trends / summary requests |
|---|---|
| sign in; reopen the app | 1 `/prs` |
| first set of a workout | 2 summary |
| each further set | 1 summary |
| open PRs | 1 `/prs` |
| open Trends | overview + exercise trend + records |
| Trends range to All | overview + exercise trend |

The background warm also refreshes `/prs` for up to six people on each boot, refocus and
five-minute tick.

### On the phone (`perf:stats`, 4x CPU throttle, History already held)

| Step | tap → shown | main-thread script |
|---|---:|---:|
| open PRs (already warmed) | 0.12 s | 0.03 s |
| open Trends | 1.74 s | 0.76 s |
| range to All | 0.94 s | 0.20 s |
| range back to 12wk (nothing fetched) | 2.14 s | 1.67 s |

The last row is rendering alone. Moving the data onto History does not touch it; it is a separate
item, not yet diagnosed.

### Folding History on the device (`frontend/src/utils/historyFold.bench.js`)

| Fold, five-year History, desktop | mean |
|---|---:|
| `buildHistoryPrFlags` (runs today, for History and Log badges) | 5.6 ms |
| whole History: PRs board + weekly buckets | 3.8 ms |
| one month refolded + every month's stored result merged | 1.1 ms |

Around 1% of today's round trip even at phone speed, and keeping one result per fingerprinted month
makes the everyday case (a set logged this month) 3.4x cheaper again.

## Decisions

- **Free plan: the Trends chart's PR dots accept the gap History's badges already have.** On Free
  the device holds 90 days, so a dot can be marked a record against the window rather than the
  person's all-time best (the server seeds that from before the window today). Same divergence as
  `historyPrFlags.js` documents; accepted 2026-09-28.
- **Trainers need nothing special.** Switching to a person re-runs the warm for them, so their
  History downloads when they are opened, whatever the tab. The cost: the first time a trainer opens
  a never-synced client, PRs and Trends wait for that full download instead of a small `/prs`.
- **The Log screen's summary stays on the server** for now. It must see all-time history even on
  Free, and #326 taught never to replace it with History. It is a candidate only once the
  equivalence oracle below proves the two agree.

## The plan

1. **Baseline** — this page.
2. **An equivalence oracle before any screen switches.** The server generates reference cases from
   random write sequences (`HistoryConvergenceTest`'s generator) — History in, `StatsService`'s
   answers out — checked in under `shared/record-rules/` and run by both suites, the way Epley and
   session volume are pinned today. Bodyweight, holds, kg/lb, the Free window, past workouts, week
   and time-zone boundaries. The device's fold must equal the server on every case.
3. **One per-month result on the device**, memoized on each month's object (unchanged months keep
   their identity through a sync), that the PRs board, Trends, and History's existing badge fold
   all read.
4. **Switch the screens**, with parity specs in every connectivity mode. Trends then works offline
   and leaves `resilience.md`'s register.
5. **Fix the server's scans anyway** — installed apps keep calling these endpoints — turning the
   probe into a `StatsCostTest` guard; retire the endpoints after a deploy window.
