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

## How it works now

The PRs board and Trends make **no requests of their own**. Both are derived on the device from
the History it holds (`hooks/useStatsFromHistory.js`, `utils/statsFromHistory.js`), so they are as
fresh as History, work offline, and show a set the moment it is logged.

### The fold: digests per month, combined per screen

- `digestSessions` holds everything about a run of workouts that does **not** depend on the viewer:
  each exercise's record candidates (best set, top weight, best set volume, most reps, longest hold,
  heaviest load held), its totals, and each workout's totals and per-exercise trend point.
- `historyDigests` makes one per month and memoizes it **on the month object**. A sync that leaves a
  month alone keeps its object (`lib/historySync.js`), so logging a set refolds only its own month.
- `prBoard`, `exerciseRecords`, `exerciseTrend` and `trendsOverview` combine the digests oldest first
  and apply what does depend on the viewer: time zone (`VIEWER_ZONE`), today, the range.
- Every output is exactly its endpoint's DTO, so the screens read it unchanged.

### Proven equal to the server

`StatsFromHistoryCasesTest` drives random, reproducible real writes through the API — everything
`HistoryConvergenceTest` drives, plus bodyweight, holds with and without load, kg (via import), exact
repeats (ties), week-edge and daylight-saving-edge workouts — and snapshots History beside every
answer `StatsService` gives: `/prs`, the overview at 4/12/260 weeks, each exercise's records and trend
at 12/260 weeks. 18 snapshots across four viewer zones, Free with History behind the window, and six
read at 00:01 local. Checked in as `shared/record-rules/stats-from-history-cases.json`.

- The backend test **fails when the server's answers change** and the file was not regenerated
  (`mvn test -Dtest=StatsFromHistoryCasesTest -Dstats.cases.write=true`).
- Generation **refuses to pass without every hard case present**, including a server answer
  actually dated in the viewer's zone. That check exists because the first generation
  double-encoded `zone` in the URL and the server silently answered every "zoned" snapshot in UTC.
- It regenerates byte-identically in a UTC JVM with a German (comma-decimal) locale, and in CI.
- `statsFromHistory.test.js` reproduces every answer field for field, **three ways**: one digest for
  the whole History, one per calendar month, and random splits. Making the combine prefer the later
  digest on a tie fails exactly the per-month and random-split runs (40 checks).

### The workout in progress

The live workout is folded in on top of History, with its **queued** sets (`useSessionEntries`,
`liveOnly`), so a record logged with no signal is on the board at once, by the same code path as
online. It replaces History's copy of that workout (never joins it) and is placed in its own month in
order. Two gaps found and closed on the way, each with a test verified red first:

- **No session yet.** Online, the first set of a workout creates its session when its save lands, so
  for that round trip there is no live session at all. The fold was gated on one, and the board read
  "No PRs yet" mid-save. Found by `stats-while-saving.spec.ts`'s per-frame sampler.
- **Saved but not yet in History.** A set leaves the queue the moment its save succeeds, but History
  holds it only once the refresh that save triggers lands (~340 ms on lower). It was in neither.
  `LOG_SET`'s `onSettled` now stamps when each set was confirmed (`lib/confirmedSets.js`), before the
  mutation reports success; the fold keeps a confirmed set until History has been fetched after that
  moment. `refreshHistory` cancels every older fetch, so that History holds it.

**Not folded, by design**, the same as History itself: a queued edit or delete of an already-synced
set, and sets queued into a past workout being edited. They show once synced; `OfflineDataNotice`
says something is waiting.

### States

`useStatsFromHistory` reports `ready` (History is here, however old), `loading`, or `unavailable`
(never held here, and the fetch is paused or failing). `unavailable` renders "PRs need a connection" /
"Trends need a connection" — never "No PRs yet", which is what the old board said offline on a device
with nothing cached. It is on `resilience.md`'s register, keyed on History's status.

### What changed around it

- The warm no longer fetches `/prs`: warming History warms both screens.
- `invalidatePrs` / `invalidateTrends` and the stats query keys are gone; `refreshHistory` is their
  refresh, and it already closes the first-load race they existed for.
- `prs-first-load.spec.ts` and `trends-first-load.spec.ts` were replaced by `stats-while-saving.spec.ts`
  (the same promise, against the screens' real source); `parity-stats-from-history.spec.ts` covers all
  four connectivity modes (with the queued-set fold disabled, the three degraded modes fail).
- The server endpoints stay for installed apps from before this, and must keep matching the cases.

## Step 5: the server's loads cost the person, not the table

Same probe, same proportions, one-workout household first:

| Request | 5-year person, before → after | 1-workout household, before → after |
|---|---:|---:|
| `/prs` | 17,266 → ~1,100 | 3,021 → 20 |
| `/trends/overview` | ~17,200 → ~1,050 | ~3,000 → 14 |
| `/trends/exercises/{id}`, `/records`, `/summary` | 5,888 → 41–45 | ~3,000 → 15–20 |

History's three syncs are unchanged. The numbers hold with every household on the preloaded
catalog (`-Dstats.probe.sharedExercises=true`), which is lower's real shape.

Three changes, each load-bearing, each with `StatsCostTest` verified red without it:

- **V84 covers the entity loads.** `IX_workout_sets_person_id_exercise_id` and
  `..._person_id_session_id` now carry every column `WorkoutSet` maps, and both
  `workout_sessions` person indexes every column `WorkoutSession` maps. The narrow
  `IX_workout_sessions_person_id` had to be covered too: with only the `started_at` one covered, the
  optimizer still picked the narrow one for the per-exercise load and looked every session up —
  5,499 reads, worse than before.
- **The queries say the session's person** (`s.person.id = :personId`, `WorkoutSetRepository`).
  Without it SQL Server can only reach a set's workout by its id: a clustered seek per set at 30k
  workouts, a scan of `workout_sessions` at 300k.
- **The per-exercise load is `OPTION (HASH JOIN)`.** Two plans answer it, and for a one-workout
  household they cost the same: hash this exercise's sets against the person's workouts (~45
  reads at five years), or walk every workout and seek its sets (~one read per workout). Compiled
  first for a one-workout household, as lower's e2e run always does, the guard's 30k-workout
  tables got the walk; the probe's 300k got the hash. A plan that flips with table size is one
  lower would eventually flip too, so the hint pins it.

**What the guard asserts, and why "is a seek" was not enough.** The first version required every
access to `workout_sets`/`workout_sessions` to be a seek with no key lookup — and passed with the
session predicate removed, because the per-set seek by id *is* a seek. It now requires each seek to
be **on `person_id`**, and the per-exercise load's set seek to be on `exercise_id` as well. Its seed
spreads each household over a pool of preloaded exercises; with every set on the same three
exercises, (person, exercise) genuinely is unselective, and the guard failed on a plan no real
household would get.

The whole-person loads (`/prs`, the overview, export) are left to the optimizer: every plan it
picks for them seeks on the person, which is what the guard holds.

### On lower, after the deploy: one more thing the plan cache decided

With #371–#374 deployed on lower (2026-09-29, barrage `api:bench` against quiet lower, 1,828-workout
History):

| Request | before (b42a2f8) | after |
|---|---:|---:|
| `GET /prs` | 2,313 ms | 1,050 ms |
| `GET /trends/overview` | 2,129–2,355 ms | **3,612–3,625 ms** |
| per-exercise (records, trend, summary) | 252–360 ms | 267–375 ms |

The overview (and CSV export, the same load in `created_at` order) got **slower**, steadily: 37
tagged calls ran 2.95–3.68 s, against 0.70–1.36 s for 53 `/prs` calls straight after. The two load
the same rows through the same joins and seeks. They differ only in their `ORDER BY` columns, and in
which household happened to compile each plan first. Query Store's only new statement doing
physical IO in that hour matched the overview/export load in count and per-call time: ~4 s of
database time per execution, with about 2.6 MB of memory each.

That fits a **sort spill**. After lower's e2e run, the first caller is a one-workout household, so
the sort is granted memory for three sets and spills a five-year person's 22,000 to tempdb. Whether
a given statement gets lucky depends on who calls it first, and production would roll the same dice.
The sort-spill reading is inferred, not observed: Query Store over ARM shows neither the plans nor
the query text.

**Fix: no `ORDER BY` in these loads at all.** `WorkoutSetRepository` sorts in Java (`CHRONOLOGICAL`,
`AS_LOGGED`), so there is no sort, and no grant to size wrong, whoever compiles first.
`StatsCostTest` now fails on any `Sort` in their plans; it was verified red in CI against the ORDER
BYs (one failure among 826 tests, naming all three loads) before the fix went in. Whether it removes
the 1.3 s on lower is measured after the deploy, not assumed.

## The plan, and where it stands

1. ✅ **Baseline** — above.
2. ✅ **Equivalence oracle**, and the record **tie rule** it surfaced (heavier set, then earlier
   workout — `.claude/rules/trends.md`).
3. ✅ **Per-month digests on the device.**
4. ✅ **The screens switched**, with parity specs; Trends works offline.
5. ✅ **The server's scans fixed anyway** — installed apps keep calling these endpoints, and the
   Log screen's summary stays a server read. `StatsCostTest` guards it (below). Retiring `/prs` and
   the Trends endpoints waits for a deploy window; `/summary` stays.
6. Later, once 4 has held on lower: History's badge fold (`historyPrFlags.js`) and the offline Log
   summary (`exerciseSummaryFromHistory.js`) could read the same digests. Deliberately not done with
   the switch, to limit what changes at once. The Log screen's summary itself stays a server read (#326).
