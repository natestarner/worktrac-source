# History sync: fingerprinted months

The device keeps a person's whole History (offline mode depends on it) and refreshes it through
`POST /api/people/{id}/history/sync`, a month at a time. This page is the reasoning; the invariants
a change must not break are in `.claude/rules/backend-core.md` ("History is synced a month at a
time") and `.claude/rules/frontend-core.md` ("History is cached a month at a time").

## Why

Before this, `GET /history` returned a person's entire history in one response (~3.7 MB of JSON at
five years of daily training) and the app fetched it:

- after **every logged set**, note, edit and delete (invalidation-driven),
- on every wake, reconnect and **5-minute** background warm, for up to six people,
- **in full after every reload**: the #337 ETag lived in a `WeakMap` keyed by the exact array, so a
  copy restored from IndexedDB never had one. On iOS the installed app is killed often, so this was
  most opens.

#337 (gzip + a shallow ETag) cut the bytes of an unchanged History to a 304, but a shallow tag is a
hash of the response, so the server still loaded, built and serialized everything to produce it.
Free households loaded every set they had ever logged and then filtered to 90 days.

## The shape

History is partitioned into **UTC calendar months** of each workout's `started_at`. Each month has a
**fingerprint** that the database computes from one aggregate query, without building the month.
The client sends `{ have: { 'yyyy-mm': fp, … } }`; the reply is

```json
{ "months": ["2026-09", "2026-08", "…"],
  "changed": { "2026-09": { "fp": "…", "sessions": [ /* HistorySessionDto */ ] } } }
```

`months` is every month the client should hold afterwards; `changed` carries content only for the
listed months whose fingerprint differs. A held month that is not listed is gone.

| When | Before | Now |
|---|---|---|
| After a logged set | whole history built + sent | fingerprint query + the current month built + sent |
| Reload / reopen | whole history, every time | fingerprint query; usually nothing sent |
| 5-minute warm | whole history built (304 on the wire) | fingerprint query |
| Free household | every set loaded, then filtered | only visible, changed months loaded |

## Why the fingerprint catches every change

Per month, over the rows the Free window admits:

- sessions, sets, notes: `COUNT(*)` and `SUM(row_version)`
- the exercises the month's sets name: `SUM(DISTINCT row_version)` (History carries exercise names)
- a `full` / `window` flag for the plan

`row_version` is a SQL Server `ROWVERSION` column (V81) on all four tables. The database stamps a new
value on every insert and update — whatever path made the write — and **every new value is greater
than every value already in the database**. So:

- an insert or update adds a value larger than anything it removed → the sum rises;
- a delete lowers the count;
- a change that keeps the count (delete one set, log another) still raises the sum, because
  everything added is newer than everything removed;
- a late-committing transaction's rows were stamped before commit, but any row it replaced existed
  before that stamp — added still exceeds removed. This is why it is `SUM` and not `MAX`: MAX would
  miss a late commit whose value is below rows already visible;
- a workout moved to another month changes the set counts of both months;
- a row added and deleted between two syncs leaves count and sum exactly as they were — and History
  is exactly as it was, so "unchanged" is the right answer.

The Free floor itself is `now − 90 days` and moves every instant, so it is **not** hashed; a workout
aging out lowers its month's count. The only way rows *enter* the visible set without a write is an
upgrade, which flips the flag and so changes every month.

#337 rejected a "version-stamp" ETag because an app-maintained stamp goes stale the first time a
write path forgets it. `ROWVERSION` has no write path to forget. The remaining risk is a **new input
to History** that is not folded into the fingerprint; `HistoryFingerprintTest` fails on a new field
in History's DTOs until it is declared covered.

## Races: why one statement, and why the re-check

Changed months are loaded by **one** `UNION ALL` statement (`HistoryMonths`) that returns sessions,
sets and notes with their row_versions, and each month's fingerprint is summed from exactly those
rows. Under `READ_COMMITTED_SNAPSHOT` one statement reads one snapshot, so a month and its
fingerprint always describe the same state. Three separate loads could return, say, a set that was
added and deleted between them — built into the month, paired with a fingerprint of a state that
never existed, and trusted by the client until something else changed that month.

Then every month the client will **keep** is re-checked. A workout moved out of a month that was
loaded into one that was not would otherwise leave it in neither on the device (or in both). If any
kept month changed during the request, the reply is a **503**, and the client's ordinary query retry
asks again. That is deliberately not a backend retry loop (`backend-core.md`: the outbox and the
query retry are the recovery story). `HistorySyncServiceTest` stages both races; they fail with the
re-check removed.

**A device that holds nothing skips both fingerprint queries.** That covers a new device, a fresh
sign-in, and the daily full sync. Every month differs from "nothing", so the first query cannot change
what is loaded, and the re-check protects only months the device keeps, of which there are none. What
remains is the one load, one snapshot, which is exactly `GET /history`. A month created mid-request
arrives on the next sync instead of refusing this one. On lower the two queries had been ~0.5s of a
five-year full sync.

**A sync that loads a range of months reaches the sets through that range's own workouts** (a seek on
`(person_id, session_id)` per workout). The whole-History load reads every set in one pass instead.
Page reads barely differ at today's sizes; the index is compact, so one person's whole range is ~150
pages. The difference is CPU (matching ~400 rows, not ~20,000) and, above all, **growth**: a one-month
sync now costs the same in year ten as in year one. `HistorySyncCostTest` fails if a range load
stops seeking each workout.

Any sync slower than 500ms logs `Slow History sync:` with the time spent preparing, fingerprinting,
loading and re-checking, so lower's split can be read rather than guessed.

## The client

`lib/historySync.js` holds the pure pieces; `api/sessions.js#getHistory` wires them to the request.

- Cached value: `{ format: 2, months: { 'yyyy-mm': { fp, sessions } }, fullSyncedAt }`.
- Readers never see that shape: `useHistory` (and `AppSettingsTab`) use `select: flattenHistory`,
  which returns the same flat, newest-first array every screen always had. Unchanged months keep
  their objects, so structural sharing keeps their sessions by identity.
- **Upgrade (axis D):** a cache persisted by an older build is a plain array. `flattenHistory` passes
  it through, so it renders — including while the server is unreachable right after the upgrade —
  and `heldForSync` treats it as holding nothing, so the first sync replaces it wholesale.
  `history-sync.spec.ts` plants a marker workout in such a cache to prove both halves.
- **Backstop:** once every 24 hours (`FULL_SYNC_INTERVAL_MS`) the client offers nothing and gets
  everything. Any undiscovered fingerprint or merge bug is bounded to a day. A missing, NaN or future
  stamp counts as due, so a device clock that was wrong cannot postpone it.
- A reply listing a month that was neither sent nor held throws — the query keeps its data and
  retries — rather than silently dropping the month.

Nothing about *when* History refreshes changed: the same eight invalidations, the ended-workout
prefetch, and the warm's `refreshAfterRestore`. History still has no optimistic writer. Two writes
that change everyone's History and used to refresh nothing now invalidate
`queryKeys.historyForEveryone()`: an exercise rename and a plan change.

## Refreshing after a write: `refreshHistory`

Every write that changes History refreshes it through one helper (`lib/queryClient.js`): cancel any
History fetch in flight, mark the query stale, then fetch **whether or not anything is observing it**.

The cancel is not decoration. The parity convergence check (below) found that ending a workout in any
degraded mode left History showing it as in progress after reconnecting. The End's refresh landed
while a History fetch that began *before* the End reached the server was still running; nothing was
observing History at that moment (the Log tab only fetches it during a live workout), and TanStack
does not cancel an inactive query's in-flight fetch on invalidation — it let the old fetch finish,
stored its answer as fresh, and cleared the invalidation, so nothing refetched for the whole
`staleTime`. `main` passed the same check, so this was a regression the slower month sync exposed.

Fetching unobserved History on every write used to be too costly — it was a full download. With the
month sync it is a fingerprint query plus, at most, the month that changed.

## Scoped syncs: after a write on this device, only that workout's months

An ordinary sync fingerprints **every** month, since any month could have changed elsewhere. On
lower that check costs ~0.5s for a five-year History and ran twice per logged set, so it was ~85% of
the sync after every set. After a write on *this* device, the device knows which workout it touched,
so it asks about only that:

- **The request** adds `sessions` (the workout ids the write touched) and `at` (the start times the
  device **holds** for them, plus any the write's response gave). `historyScopeFor` builds both.
- **The server** scopes to the months those times fall in **plus the month each workout is in now**,
  which it looks up itself, only among the person's own workouts. The two differ when the workout
  was moved to another date elsewhere. Reloading only the held month would leave that month
  correctly empty and the workout **nowhere** on the device; reloading only the current month would
  show it twice. The server computes every month; the client never computes one.
- **Only the scoped months are loaded**, in one statement: one snapshot, each month's fingerprint
  from its own rows. There's no all-months fingerprint query and no re-check, so nothing is left for
  a mid-request write to break.
- **The reply carries `scope`.** The client replaces or drops only those months and keeps every other
  month exactly as held (`applyHistorySync`). A reply without `scope` is an ordinary reply. That
  covers every sync from an older app, and every reply from a server that predates scoped syncs, so
  either side can deploy first.

**Which writes are scoped:** logging, editing or deleting a set; saving a note; creating a past
workout. **Which stay ordinary:** ending a workout, moving a workout's date, imports, exercise renames,
plan changes, History's own refresh, and anything whose workout the device can't name (a set still
waiting for its session). A device holding nothing, or due its daily full sync, ignores the scope.

**The accepted cost:** a change made on **another** device, in a month this write didn't touch, reaches
this device at the next ordinary sync rather than on its next set. Ordinary syncs run on app open,
on refocus, on the 5-minute warm, when History is opened stale, and daily in full. Nothing is lost
or wrong in the meantime, only later. Real-time cross-device updates, if ever wanted, would come
from a push that only says *"History changed, sync now"* (Server-Sent Events), never from a second
data path.

**A scope is owed until a refresh completes.** `refreshHistory` cancels the fetch before it, so as
first shipped, a second write replaced the first write's scoped sync with its own. Edit a set in an
August workout, log one in today's September workout a moment later (or let both drain from the
outbox together), and August kept the old set, with the query marked fresh so nothing refetched it,
until the next ordinary sync. That broke the promise above that *this* device's own writes are always
current, and it was found in review before production. Now each refresh adds its scope to a per-person
debt, and the request sends the whole debt, read when it goes out rather than when it was asked for
(two refreshes in one tick share one request). The debt is cleared only when a request that carried it
succeeds. An owed ordinary refresh, or a union past `HistorySyncRequest`'s bound of 8, makes the next
refresh ordinary.

**An ordinary sync is owed too.** A second gap was found on lower, after the fix above: an app
opened with a set still queued offline, after another device had changed a workout in another month.
The boot warm's ordinary sync is what re-verifies that month, and the queued set drained at the same
moment, in one of two orders:
- the drained set's scoped refresh cancelled the boot sync, whose answer carrying the other device's
  change arrived and was thrown away;
- or the warm's `prefetchQuery` joined the scoped fetch already in flight and never sent its own.

Either way that month stayed stale until the next ordinary sync. Now `refreshHistory` knows which
fetch is its own (`inFlight`). Cancelling any other fetch, in flight or paused offline, makes the
refresh ordinary, and the warm refreshes History through `refreshHistory` rather than a prefetch.
The warm still **joins** an ordinary sync already in flight (a screen's own fetch, or an earlier
warm). Only a scoped one is replaced, because the server finishes a request the app abandons: a
fresh sign-in otherwise downloaded the whole History twice.

**Requests per everyday flow**, measured with the same flows on each build (every request sent
counts, including one the app later abandons):

| Flow | Before the overhaul | Now |
|---|---|---|
| Sign in on a new device | 1 full download | 1 full sync |
| Reopen the app | 1 full download | 1 fingerprint check |
| Each logged set | 1 full download | 1 scoped sync (that month) |
| Back to the session list | 1 full download | 1 fingerprint check |
| Reopen with sets queued offline | 2 full downloads | 2 fingerprint checks |
| End workout | none | 1 fingerprint check |

**Tested:**
- `HistoryConvergenceTest` has a sixth device that scoped-syncs after every write it makes and
  ordinary-syncs every 5–15 writes. After each scoped sync, every scoped month must equal
  `GET /history`'s, and **the workout just written to must be on the device**. After each ordinary
  sync, *everything* must match, so nothing a scoped sync skipped can stay wrong.
- `HistorySyncTest` pins the moved-workout case deterministically. It fails with the current-month
  lookup removed.
- `sessions.test.js` pins that out-of-scope months survive by identity. It fails if a scoped reply
  is merged as an ordinary one.
- `queryClient.test.js` ("the scope a cancelled refresh was owed") pins the debt. It covers a cancelled
  refresh, a failed one, two refreshes in one tick, an owed ordinary refresh, and the bound. All five
  fail against the refresh that captured its own scope.
- `history-refresh-owed-scope.spec.ts` drives the real trigger: a set added offline to a workout
  40 days back and one to today's, drained together on reconnect with each sync answered 2s late.
  The app's persisted History must then equal the server's. It fails without the debt.
- The same spec's app-open case: a set queued offline, the app closed, another device adds a set to
  an older month, then the app reopens with syncs answered 2s late. It fails without the ordinary
  debt, because the app threw away the answer that carried the change.

## How the property is tested

The property is **"however far behind a device is, one sync leaves it holding exactly `GET /history`"**
— if it holds from every state a device can be in, History can lag but never be stuck.

| Test | What it proves |
|---|---|
| `HistoryFingerprintTest` | Every write kind — through the API *and* as raw SQL behind the app's back — moves exactly the right month's fingerprint; no month's content changes without its fingerprint changing; month boundaries to the 100ns; the aggregate and row-derived fingerprints always agree; every table the loader reads is fingerprinted and carries a `row_version` |
| `HistoryConvergenceTest` | Seeded random sequences of every write (incl. plan flips, clock aging, a sibling's writes), five simulated devices from "syncs every write" to "restored from an old snapshot" to "holds nothing"; after each write, one sync from each must equal the truth. 10,000 writes soaked green; a counts-only fingerprint fails within 5–26 writes |
| `HistoryConcurrencyTest` | Writers and syncing devices at once, under RCSI; every state any device reached converges in one quiet sync. Catches a fingerprint paired with the wrong snapshot |
| `HistorySyncServiceTest` | The sync's decisions and its two mid-request races, deterministically |
| `refreshHistory` unit tests | A fetch from before a write can never be kept over the write |
| Every parity spec | After reconnecting, the app's **persisted** History equals the server's, in all four modes |
| `HistorySyncCostTest` | Every shape of both statements seeks through the person's own rows: no scan, no key lookup, read back from the plans SQL Server actually compiled (see "Cost") |
| `history-sync.spec.ts`, `offline-durability.spec.ts` | Reloads re-download nothing unchanged; another device's change arrives; an old-format cache renders offline (lie-fi and a true no-network cold boot) and is then replaced |

## The production canary

The daily full sync re-reads months the device had been trusting. If one comes back with the
**same** fingerprint but **different** content, the fingerprint missed a change — the one failure the
tests above exist to prevent. The device reports the month ids (`POST /api/people/{id}/history/drift`)
and the server logs a WARN; the full sync has already corrected the device. Look for it with:

```kql
ContainerAppConsoleLogs_CL
| where Log_s contains "History drift:"
| project TimeGenerated, Log_s
```

It should never return a row. If it does, some input to History is missing from both fingerprint
computations (`HistoryFingerprints`, `HistoryMonths`).

## Degraded conditions

The sync fails exactly like any other read (`api/client.js`): offline and pinned-offline pause it;
lie-fi aborts it at 15s and reports to `reachabilityMonitor`; a 503 is a fulfilled response. In every
case the query keeps the months it holds, and `shouldDehydrateQuery` persists them. The service
worker caches no API calls, so the move from GET to POST changed nothing there.

## Cost

**Every statement must cost in proportion to this person's rows, never the table.** Local and test
databases hold a few households, so the two are indistinguishable there. Lower holds every e2e
household ever created, and there the difference was a ~0.3s full sync against a 10-minute one at
100% DTU (`docs/incidents/2026-09-25-history-full-sync-pegged-lower-db.md`). Four things keep it
proportional:

- **Covering indexes (V83).** Each History-sync index carries every column the aggregate and the load
  read. Without that, SQL Server chooses between a key lookup per row and a scan of the whole table,
  and at lower's size it picks the scan.
- **Exercises by the person's distinct ids.** Both statements look each exercise up once, never once
  per set.
- **Join hints.** `HASH` to take the person's sets in one pass of their index range; `LOOP` to reach
  notes and exercises by seek from the person's own sessions and exercises. Left alone, the optimizer
  chose a pass over the notes index at lower's proportions.
- **One cached plan per size of History, with runtime feedback off (`HistoryPlanSize`).** People
  differ by four orders of magnitude, from a new household's five sets to a daily lifter's twenty
  thousand. A cheap count of the person's workouts picks an order-of-magnitude class, and each class
  gets one cached plan, compiled once for someone within a factor of ten of whoever uses it. Three
  details are load-bearing, and each was found on lower:
  - **The class marker goes INSIDE the statement, after its `WITH`.** Query Store drops a *leading*
    comment when it identifies a statement, so a marker in front separated the plan cache but left
    every class as **one Query Store query**. Everything Query Store keys on a query, persisted
    memory grant feedback and Azure's automatic plan correction among them, was then shared between
    a five-set household and a five-year History.
  - **Every per-execution feedback mechanism is off** (`NO_RUNTIME_FEEDBACK`): memory grant feedback
    (row mode, batch mode, persistence), CE feedback, DOP feedback and batch-mode adaptive joins. On
    lower a *reused* plan ran the five-year History in 52–61s at 100% CPU, even one compiled for that
    very person (#349: 6.4s on its first run, ~57s on every run after). With feedback off the same
    cached plan runs in about 3s, every time (#351). It never reproduced locally, where there is
    memory to spare.
  - **Never `OPTION (RECOMPILE)`.** It gives every execution the right plan (#348, #350: 3.2–5s), but
    compiling these statements is so expensive on Basic tier that recompiling for everyone held
    lower's database at **100% CPU for 35 minutes** through an e2e run. Recompiling only for large
    Histories kept e2e healthy, but made each large-History sync pay three compiles: 3.3s per logged
    set against 1.7s cached.

Measured against lower-sized local tables (300k workouts, 1.2M sets, 100k notes, 40k exercises) for a
person with 1,827 workouts:

| Statement | Before | After |
|---|---|---|
| Month load (`HistoryMonths`) | ~62,000 page reads (scan of `workout_sets`), plus 57,302 for per-set exercise lookups | ~5,300 (sets 292, notes ~5,000 by seek, exercises 24) |
| Fingerprint aggregate | ~44,000 | ~6,700 (sets 360, notes ~5,000 by seek, exercises ~1,300) |

The notes figure is about three reads per workout: a seek per session. It grows with the person and
nothing else. `HistorySyncCostTest` pins the shape rather than any number. It runs every statement for
a one-workout household first, then twice for a big one, and reads the plans back from Query Store. It
fails in three cases, one for each way lower broke:
- the big person reused a plan compiled for someone else;
- a small household's repeat run compiled anything;
- any scan or key lookup of a History table.

**If it fails after you add a column, add the column to the index in a new migration. Don't relax the
test.**

**Lower's Query Store is readable** through the ARM `topQueries` API with the read-only principal
(per-query executions, CPU and duration by hour; the query text is not readable). That is how both
plan problems were found:

```bash
MSYS_NO_PATHCONV=1 az rest --method get --output-file C:/tmp/topq.xml --url "https://management.azure.com/subscriptions/<sub>/resourceGroups/worktrac-rg/providers/Microsoft.Sql/servers/worktrac-sql-server/databases/worktrac-db-lower/topQueries?api-version=2014-04-01&resourceType=duration&numberOfQueries=10&aggregationFunction=sum&interval=PT1H"
```

## Not covered here

`/prs` still loads every set a person has logged on each call, and is refreshed after every set
(`StatsService#getPrList`). Its reply is small, but its server work grows with history exactly the
way History's did. It is the next thing to look at if the server is where the cost shows up.
