# 2026-08-13 — The e2e suite only passed at `--workers=1`

## Symptom

Specs failed under parallel workers and passed at `--workers=1`. The failures moved between runs
and landed in unrelated specs, which is the signature of a data-isolation bug — so the standing
question was whether the suite had found a real concurrency defect in the app. The working
practice had become "rerun at `--workers=2`, then `--workers=1` before believing a failure", which
made every red run cost two more full runs to interpret.

## What it was not

Not data collision. Every spec registers its own household, gets its own browser context, and all
app data is account-scoped in the schema. Nothing is shared between tests by construction, and two
full-suite baselines (109 tests at 4 workers, then at 11) both passed on a quiet machine — 2.1 min
and 1.0 min respectively. **The specs were not the problem.**

The flakiness came from four independent things, three of them environmental, one of them a real
concurrency defect that only local ever saw.

## Root cause 1 — local SQL Server did not match Azure SQL (the real defect)

The backend log from the 11-worker run carried:

```
CannotAcquireLockException: ... Transaction (Process ID 94) was deadlocked on lock resources
with another process and has been chosen as the deadlock victim.
  at StatsService.getBest(StatsService.java:71)
  at WorkoutSetService.insertSetAndDetectPr(WorkoutSetService.java:148)
  at WorkoutSetService.logLiveSet(WorkoutSetService.java:75)
```

`insertSetAndDetectPr` reads and writes `workout_sets` in one transaction:

1. `getBestComparableLb` — SELECT over `IX_workout_sets_person_id_exercise_id`
2. `save(...)` — INSERT, taking X locks on the clustered index *and* every non-clustered index
   (`IX_workout_sets_session_id`, `IX_workout_sets_person_id_exercise_id`,
   `UX_workout_sets_client_key`)
3. `getBest` — the same SELECT again

Under READ COMMITTED **without** row versioning, step 1 and step 3 take shared locks. Two of these
transactions running at once acquire the clustered and non-clustered indexes in opposite orders and
deadlock. Different accounts do not help: page-level locks cover many rows, so unrelated households
still collide on the same index pages.

**Azure SQL Database enables `READ_COMMITTED_SNAPSHOT` by default. A stock SQL Server container has
it off.** Every local worktree database had `is_read_committed_snapshot_on = 0`. So local was
running a *different and less concurrency-safe* isolation model than lower and production, and the
local e2e suite was paying for a deadlock class that no deployed run can reproduce.

The app already degrades correctly — a 500 is transient to `shouldRetryWrite`, so the durable
outbox retries and the write lands — which is why this cost latency and intermittent noise rather
than lost data, and why it never announced itself as a deadlock.

**Fix:** `scripts/db.sh` sets `READ_COMMITTED_SNAPSHOT ON` on every worktree database, guarded on
the current setting so a re-run never kicks a live backend's connections. `db-reset.sh` does the
same for a freshly recreated one. No application change: retrying at the backend would be a second
retry mechanism next to the outbox, which `.claude/rules/resilience.md` exists to prevent.

## Root cause 2 — the registration rate limiter punished *fast* runs

`app.rate-limit.per-ip-per-hour` and `global-email-sends-per-hour` were 1000 locally. Every test
registers a household, so a full suite spends ~109 tokens from each bucket, and every local run
shares the same two buckets — one backend, one source IP.

Bucket4j refills greedily at capacity/hour, so what decides whether you run out is **how long the
suite takes**:

| Workers | Run time | Spent | Refilled during the run |
|---|---|---|---|
| 1 | ~8 min | 109 | ~130 — breaks even, iterate all day |
| 11 | ~1 min | 109 | ~17 — the bucket drains a few runs in |

So the faster the suite ran, the sooner registrations started coming back `429`. **This is a real
mechanism by which "it only passes at `--workers=1`" is literally true while nothing is wrong with
parallelism at all** — and it surfaces as `registerHousehold` failing in whichever arbitrary specs
happened to run after the bucket emptied, i.e. a different set of tests every time. That is exactly
the moving-target signature that reads like a data-isolation bug.

**Fix:** local caps raised to 100000. There is no abuse to defend against on localhost; the number
is now one no local suite can reach rather than one that merely looks generous.

## Root cause 3 — the local backend was never sized for a parallel suite

- **HikariCP was on its default max of 10.** One backend serves every worker, and each page load
  fires a burst of parallel reads. A saturated pool queues requests past the frontend's
  `REQUEST_TIMEOUT_MS` (15s), and an aborted fetch is a *rejected* fetch — the one thing that trips
  `reachabilityMonitor`'s lie-fi detection. An overloaded local backend therefore doesn't just make
  tests slow, **it puts the app into a different connectivity state than the test arranged**, and
  the spec then fails claiming a resilience bug that does not exist. Raised to 40 (`DB_POOL_SIZE`).
- **`spring.jpa.show-sql` was `true`.** 7461 of 8414 backend log lines in a full run were SQL echo,
  written synchronously on the request path, for output nothing reads unless someone is debugging a
  query. lower and production already set it false. Now off by default, `SHOW_SQL=true` to opt in.

## Root cause 4 — the time budgets never knew the run got busier

`playwright.config.ts` set no `timeout` at all, so per-test budget was Playwright's 30s default,
and `expect.timeout` was a flat 5s locally.

Contention scales the wall-clock of every test. Measured on a 22-core machine, the slowest spec
takes ~8s alone, 12.3s at 4 workers, and 19.2s at 11 — a 1.49× median inflation from 4 to 11. A
fixed budget therefore shrinks in real terms every time you add a worker, until specs fail on the
clock rather than on a defect.

**Fix:** both budgets derive from the resolved worker count. `resolveWorkerCount()` reads the same
inputs Playwright will (CLI `--workers`, then `E2E_WORKERS`, then a default), because Playwright
resolves `workers` *after* the config is evaluated — without that, `--workers=11` would run on a
2-worker budget, which is the precise failure the scaling exists to prevent.

This removes no coverage. Nothing in the suite asserts that the app is fast, so a longer timeout
changes only how long a genuinely stuck test takes to report. The budgets stay bounded and scale
rather than being one flat generous number, so a real hang still fails in tens of seconds.

## Root cause 5 — the boot skeleton's header was interactive, and boot throws it away

With causes 1–4 fixed, exactly one spec still failed under parallel workers and passed 5/5 alone
(`multi-person.spec.ts` → *"logging out and back in resets every person's tab to Log"*). It burned
its **entire** 85s budget on `getByRole('menuitem', { name: 'Logout' })` — an 85s wait for a menu
that opens in milliseconds is a hang, not contention, so the budget was not the problem.

Running six parallel copies of that one spec reproduced it 1-in-6. An instrumented probe sampling
the DOM every animation frame after the post-reload click gave the answer outright:

```
t=423  expanded=false  menu=false  items=0     <- before the click
t=474  expanded=true   menu=true   items=3     <- menu opened, Logout present
t=3161 expanded=NO-BUTTON menu=false items=0   <- the trigger itself left the DOM
t=3180 expanded=false  menu=false  items=0     <- a different Header mounted, menu closed
```

`NO-BUTTON` is the tell: the header wasn't re-rendered, it was **unmounted**.

`ProtectedRoute` renders `<AppShellSkeleton/>` while `status === 'loading' || !hydrated`, and
`AppShellSkeleton` renders a **real, fully interactive `<Header/>`** — deliberately, so the boot
paint matches the loaded one pixel-for-pixel. When boot finishes it swaps to `<AppShell/>`, which
renders its *own* `<Header/>` in a different tree position. React unmounts one and mounts the
other, and `UserMenu`'s `open` is plain `useState`, so it goes with it.

So this is a real user-facing bug, not a test artifact: **reload, tap your name before boot
finishes, and the menu opens and then silently closes itself.** The measured window was 2.7s under
load, and it is *wider* in exactly the conditions this project cares most about — cold start,
lie-fi, a slow connection — because that is when boot takes longest.

**Fix:** `AppShellSkeleton` passes `booting` to `Header` → `UserMenu`, which disables the trigger.
The control stays rendered (no layout shift, pixel parity preserved) but isn't armed until the
header that will survive is mounted. That converts a silently-dropped interaction into a
well-defined wait — including for anything *driving* the app, since Playwright's actionability
check waits for a disabled button rather than opening a doomed menu.

Note what was **not** done: the spec was not taught to wait for boot. Hardening the test around
this would have hidden it, which is the same mistake `2026-08-12-prefill-overwrites-typed-weight`
records — a product bug that lived inside test infrastructure for four days.

The deeper structural fix — hoisting the chrome above the skeleton/shell branch so it is never
unmounted at all — is better UX (the menu would simply keep working) but conflicts with
`AppShell`'s `.app-chrome` sticky-unit grouping, so it is left as a follow-up rather than made
blind at the end of a parallelism investigation.

## Takeaways

- **A local datastore that differs from the deployed one in its isolation level is not a local-only
  concern.** It makes local strictly less safe than production and burns the time budget of
  everyone debugging the difference. Check `is_read_committed_snapshot_on` before concluding a
  deadlock is an application defect.
- **"Only passes at `--workers=1`" is not evidence of a data-isolation bug.** Two of the four causes
  here scaled with *run duration* or *machine contention*, not with test independence.
- **Timeouts that don't scale with parallelism are a latent flake.** They silently convert "I raised
  the worker count" into "the app got flaky".
- **An overloaded backend can look like a connectivity bug, not a slow one**, because a client-side
  abort and a dead network are the same event to the fetch layer.
- **A spec that burns its whole timeout is reporting a hang, not slowness.** 85s for something that
  takes 40ms is a different failure from 19s for something that takes 12s; raising the budget can
  only ever fix the second. Read the duration before reaching for the timeout.
- **Transient UI that renders "for real" must not also be interactive.** A tree that exists only
  until an async boundary resolves will discard anything the person does in it, and local component
  state is the first casualty. If it can be clicked, it needs to either survive or be inert.
- **Parallelism was the microscope, not the disease.** Every defect here was reachable by one user
  on a slow connection; workers only made it likely enough to see. "Fixing" the suite by lowering
  the worker count would have put both real bugs back into the blind spot.

## Still open — but newly narrowed: the mid-run dev-server death

Separate from everything above, and **not fixed**: the Vite dev server still dies partway through
some full runs. This is the pre-existing `KNOWN UNRESOLVED` issue in `scripts/up.sh`. With the five
causes above fixed it is now the **dominant** remaining source of red runs, and the one that most
looks like a code regression, because it fails a scattered block of unrelated specs at once.

**Why it stayed unresolved: the diagnostic was being erased by the recovery.** `up.sh` records an
`[[frontend exited rc=N]]` marker precisely to answer "did it exit on its own, or was it killed?"
— but it opened the logs with `>`, which truncates. The actual sequence is: frontend dies mid-run →
`e2e.sh` finds the port dead → `e2e.sh` calls `up.sh` → `up.sh` truncates `frontend.log` → the
marker is gone. Because `e2e.sh` restarts a dead stack automatically, that erasure was *guaranteed*
on exactly the occasions the marker existed for. **It had therefore never once been read.**

Fixed here: `up.sh` now appends with a `[[<name> started at ...]]` banner per start (rotating at
20MB), and `e2e.sh` scopes its marker search to the last session so old deaths aren't re-reported
as this run's. Verified by stopping and restarting the stack — the `exited rc=` lines from the stop
now survive the restart and are readable.

**A conclusion drawn earlier in this investigation was wrong because of that erasure.** It was
recorded here that the absent marker meant "something killed it". That inference was unsound: the
log had been overwritten by the restart *following* the death. Whether Vite exits on its own or is
killed is **currently unknown**, and the next occurrence will answer it.

What does stand, checked live rather than inferred from a log:

- **It is always the frontend. The backend is never affected.** Every failing run ended
  `backend=UP frontend=DOWN`, probed directly before and after each of four consecutive runs. The
  runbook previously treated both servers as equal suspects; it can stop.
- **It is load-dependent, not deterministic.** The same stack survived several full runs and then
  died three consecutively; the surviving runs were the fastest. Running anything else on the
  machine during a suite (a lint, a vitest run, a second suite) makes it markedly more likely —
  three of those deaths were self-inflicted that way.

One *hypothesis* for the frontend/backend asymmetry, to be tested against the marker rather than
assumed: `up.sh` falls back to plain `nohup` because `setsid` is absent from Git-for-Windows bash,
so both servers stay in the invoking shell's process group — but `mvn spring-boot:run` forks a
separate JVM (a detached grandchild that outlives a process-group teardown) while `npm run dev`
leaves Vite a direct descendant that does not. If the next death *does* carry an `rc`, this is
wrong and the answer is on the lines above it.

**Practical consequence today:** `e2e.sh` prints a loud "results are NOT trustworthy" banner, so it
can't be mistaken for a regression. Re-run after `bash scripts/up.sh` and don't run anything else
concurrently.

## Still open (deliberately not fixed here)

`StatsService.getBest` / `getLastSession` load **every set ever logged** for a person+exercise via
`findByPerson_IdAndExercise_Id` and compute the max in Java — twice per logged set, on the write
path. RCSI removes the deadlock, but the O(n) read stays and grows with training history. That is a
performance change with its own testing needs, not part of this fix.
