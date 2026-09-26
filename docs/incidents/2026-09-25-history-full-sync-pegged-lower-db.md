# 2026-09-25 — One History full sync ran ~10 minutes at 100% DTU on lower

## Symptom

Right after #343 (History synced a month at a time) deployed to lower, a single full sync for a
seeded account (1,827 workouts, 21,916 sets, five years) answered **504** at the Container Apps
ingress's 240s limit. The lower database sat at **100% DTU for 14+ minutes**. The container logs
showed the abandoned requests finishing ~10 minutes later with `Broken pipe`, because the client had
long since gone. The same request took **~0.3s locally**, and every lower e2e spec passed, since each
one runs against a brand-new household with a handful of sets.

Before #343, the same account's `GET /history` took ~2s on lower.

## Root cause

Every statement cost in proportion to the **table**, not the person, and nothing local could see it.
Lower's tables hold every e2e household ever created (well over a million sets), so a pass over the
whole table is expensive there and free on a developer machine.

1. **V82's indexes did not cover the month load.** `HistoryMonths` reads weight, reps, unit,
   duration and created_at for each set. `IX_workout_sets_person_id_session_id` carried only
   `exercise_id` and `row_version`, so SQL Server had two choices: a key lookup per set, or a scan
   of the whole clustered index. At lower's size it judged the scan cheaper. Measured locally
   against lower-sized tables, the load read **62,000 pages; with covering indexes (V83), 231.**
2. **The exercise lookups ran once per SET.** The load joined `exercises` per set row; against a
   40k-row exercises table that was **57,302 page reads** for one History. It now looks up the
   person's *distinct* exercises once each: **24**.
3. **The fingerprint aggregate left the plan shape to the optimizer.** At lower's proportions it chose
   a full pass over the notes index, and the exercise part again worked per set. That came to 44k
   reads, and 7.4k with the covering indexes. With the join hints pinning every table to be reached
   through the person's own rows, the reads are proportional to the person again.

On a 5-DTU Basic database, a few hundred thousand page reads per request is the whole budget. Each
retrying device, plus the daily full sync, queued another one.

## Fix

- **V83** rebuilds the three History-sync indexes with every column the aggregate and the load read.
- `HistoryMonths` and `HistoryFingerprints` look up exercises through the person's distinct
  exercise ids. They carry `HASH`/`LOOP` join hints so every table is reached through this person's
  rows: their index range, their sessions, their exercises.
- **`HistorySyncCostTest`** runs both statements in every shape they are issued in. It reads back the
  plans SQL Server actually compiled from the plan cache, and fails on any scan or key lookup
  against a History table. It seeds lower's *proportions* (a person with ~4 years of daily History
  beside a much larger household), because plan shape depends on them. Verified non-vacuous both
  ways:
  - reading a column the index doesn't cover fails with the exact lower plan, a clustered index
    scan of `workout_sets`;
  - removing the join hints fails with the notes-index pass.

## Round two: the fix passed every test and still ran ~50s on lower

After #345 deployed, one full sync took **81s cold and 52s warm**. Lower's DB was at **100% CPU** with
no data reads for the warm one. Locally the same request took 0.2s, and the old `GET /history` had
taken ~2s on lower. So the statements were right and the plan lower actually ran was not.

**Lower's Query Store is readable over ARM** (`topQueries`; see `docs/architecture/history-sync.md`,
"Cost"). One query that appeared only after the deploy accounted for 127s over 261 executions,
almost all of it the two probes.

The cause was **the plan cache**. Lower's e2e run syncs hundreds of five-set households minutes
before anyone with real History does, so the cached plan was compiled for five rows. Reproduced
locally by running a tiny person first and then the big one:

- the memory grants were sized for five rows and spilled to tempdb (sort and hash spills in both
  statements);
- the aggregate's final month joins became nested loops, re-running the notes aggregate once per
  month (52 executions, with spools replaying 2,704 rows each time).

Locally that costs 40ms instead of 28ms. On Basic tier, under lower's statistics, it was the
difference between ~1s and 50s.

## Round three: RECOMPILE fixed the plan and pegged the CPU

The first fix for round two was `OPTION (RECOMPILE)` on both statements (#348), so every execution
got a plan compiled for its own person. It worked for the big person: **5.0s, then 3.5s** for the
five-year sync, against 52s before, and 2.6s for the legacy `GET`, close to the pre-#343 2.0s.

But lower's e2e run after that deploy failed across the board: registration timeouts, outbox
drains, unrelated specs everywhere. The database sat at **96–100% CPU for 35 minutes**. #347's
deploy, the same code without RECOMPILE, had peaked at 64%. Query Store showed almost no
*execution* CPU for any statement, so the load was compilation. These CTE-heavy statements cost ~10ms
to compile locally and far more on Basic tier, and e2e issues hundreds of syncs. Nothing was
promoted to production.

**Fix:** one cached plan per size class (`HistoryPlanSize`). A count of the person's workouts, a seek
on their range, gives the number of digits in it. A comment naming that class is prepended to the
statement text, so SQL Server caches one plan per class. Each is compiled for someone within a
factor of ten of whoever uses it, and compiled once.

`HistorySyncCostTest` runs a one-workout household first, then the big person twice, and reads
plans from **Query Store**. Each of its three checks was verified red by the mistake it guards
against:

| Mistake | Check that fails |
|---|---|
| no size class | the big person ran a plan compiled for the tiny one |
| `OPTION (RECOMPILE)` | a statement compiled again on the repeat run |
| an uncovered column | a scan of `workout_sets` |

Query Store keeps compile times to about 10ms, rounded either way, so the test leaves a gap on both
sides of each timestamp. Without the gap it flaked in both directions.

## Round four: a reused plan was slow even when compiled for the right person

#349's per-size plans kept the e2e run healthy: 69–80% CPU for 10 minutes, all specs green. But the
five-year History was fast only on the **first** execution of its freshly compiled plan (6.4s). Every
execution after that took **57–61s**, on an idle database at 100% CPU. So the problem was never only
*who* the plan was compiled for; a **reused** plan was slow and a freshly compiled one was fast. The
likeliest cause is memory grant feedback shrinking the grant of a reused plan on a memory-starved
Basic tier. It does not reproduce locally, where feedback grows the grant and nothing spills.

**Fix:** by size. 100 workouts or more are compiled per execution, the arrangement measured at 3.5–5s
on lower. Smaller Histories, which includes every e2e household, keep one cached plan per class, so an
e2e run compiles almost nothing. `HistorySyncCostTest` now requires the *tiny* household's repeat run
to compile nothing, and the big person's plans to be compiled for them. Both were verified red:
RECOMPILE for everyone fails the first, and no size class fails the second.

## Takeaways

- **A test database's size hides cost, but its *proportions* decide the plan.** Timing a query
  locally proves nothing. Assert the plan's shape instead: a seek through the person holds at any
  size, and a scan of the table is the thing that grows.
- **Measure on lower before calling a server-side performance change done**, one request at a time
  while watching DTU. The bench that caught this was a single request.
- Covering indexes are part of the query. Adding a column to either statement means adding it to
  the index; `HistorySyncCostTest` says so when you forget.
- **A per-person statement over wildly different people needs a plan per size of person, not per
  call.** A test that compiles fresh for the person it measures can never see parameter sniffing.
  Run a tiny tenant first, the way production's traffic does, then assert on the big one. And
  `RECOMPILE` is not free: on a 5-DTU database the compile *is* the cost.
- **A fix that works for one request can still fail under load.** The single-request probe said
  RECOMPILE was fixed; the e2e run, a few hundred requests, said otherwise. Check CPU across a whole
  e2e run, not just one probe.
- **Read lower's Query Store before guessing.** It turned a day of theories into one query id.
