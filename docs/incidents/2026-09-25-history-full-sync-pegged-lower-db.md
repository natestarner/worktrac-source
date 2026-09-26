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

**Fix:** `OPTION (RECOMPILE)` on both statements, so every execution is compiled for its own person.
It costs ~10ms of compile per statement. `HistorySyncCostTest` now runs a one-workout household
first and reads plans from **Query Store**, because RECOMPILE plans are never cached. It requires the
big person's plans to have been compiled during the big person's run. Verified red with RECOMPILE
removed. Query Store keeps compile times to ~10ms, so the test leaves a gap on both sides of its
timestamp; without one it flaked in both directions.

## Takeaways

- **A test database's size hides cost, but its *proportions* decide the plan.** Timing a query
  locally proves nothing. Assert the plan's shape instead: a seek through the person holds at any
  size, and a scan of the table is the thing that grows.
- **Measure on lower before calling a server-side performance change done**, one request at a time
  while watching DTU. The bench that caught this was a single request.
- Covering indexes are part of the query. Adding a column to either statement means adding it to
  the index; `HistorySyncCostTest` says so when you forget.
- **A per-person statement over wildly different people needs a per-person plan.** A test that
  compiles fresh for the person it measures can never see parameter sniffing. Run a tiny tenant
  first, the way production's traffic does, then assert on the big one.
- **Read lower's Query Store before guessing.** It turned a day of theories into one query id.
