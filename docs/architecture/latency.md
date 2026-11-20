# Where a request's time goes (and the levers we haven't pulled yet)

Measured 2026-11-20, when production got its first real external user and the app felt slow. Nothing
here is a bug or a misconfiguration. It is the cost of the current setup, written down with the
evidence so a later change can be judged against it, plus the three levers left unpulled. The
monitoring section says how to tell when one of them is worth pulling.

## The short version

A request's time is roughly **(database round trips x per-trip network) + (time waiting for CPU)**.
The database itself is never the slow part: in Query Store every statement averages under 6 ms, most
under 1 ms.

| Part | Size in production | Why |
|---|---|---|
| Network per round trip | ~25-35 ms until 2026-11-20; now a few ms | The app ran in East US, the database in Central US. The app moved beside it on 2026-11-20 (below) |
| Round trips per request | 5-10 (a History sync with nothing new: 8) | 4 are the app's own queries; ~4 are framework defaults per transaction |
| CPU wait during an app open | ~400 ms per request at 0.5 vCPU | An app open sends ~25 requests at once |

A History sync during an app open took 600-700 ms in production on 2026-11-20: about 250 ms of
network (8 trips) plus about 400 ms of waiting for CPU.

## Round trips: what one request actually sends

Counted with an Extended Events session on the local SQL Server (`scripts/diagnostics/db-round-trips.sh`).
A History sync whose months are all unchanged, on Free and on Plus alike:

| # | Trip | Whose |
|---|---|---|
| 1 | `SELECT 1`: Hikari checks a connection idle for more than 500 ms is alive | framework default |
| 2 | `set implicit_transactions on`: the transaction starts (`setAutoCommit(false)`) | framework default |
| 3 | The person guard (`requireVisiblePerson`) | the app, deliberately |
| 4 | The household's plan (`historyFloor`, Free's 90-day window) | the app, deliberately |
| 5 | `COUNT_BIG(*)` of the person's workouts (`HistoryPlanSize`, the plan size class) | the app, deliberately |
| 6 | The fingerprint query | the app, deliberately |
| 7 | `IF @@TRANCOUNT > 0 COMMIT TRAN` | framework default |
| 8 | `set implicit_transactions off` | framework default |

On top of those 8, on most app opens:
- `HistoryEpoch`'s `sys.databases` read, whenever its 5-minute cache has expired.
- **Two before the transaction**: `JwtAuthenticationFilter` re-reads the login's access (user,
  membership, plan) whenever `AccountAccessService`'s 60-second cache has expired, which it usually
  has when somebody opens the app.

So an app-open sync is closer to 10-11 trips. Every request has the same shape: `GET /api/tags` is 5 trips for 1 query, `/me` about 10 for 5.
The whole sync runs on one connection; there is no hidden second borrow and no driver metadata call.

None of the framework trips is wrong. They cost almost nothing when the database is next door, which
is why nobody tuned them; they matter here only because each one crosses regions.

## Network: why the app and the database were in different regions

> **Resolved 2026-11-20: the app moved to Central US** (`region-move.md`). Server-side `/me`, p50:
> lower 314 -> 16 ms (4,000+ requests either side), prod 372 -> 17 ms (first 13 after the cutover).
> Signed-in requests from the owner's machine, which is ~33 ms further from Central US: `/me`
> 341 -> 82 ms, a no-change History sync 331 -> 82 ms. The rest of this section is the history.

When the database was created (July 2026), this subscription's `eastus` and `eastus2` both refused new
SQL servers (`RegionDoesNotAllowProvisioning`), so it went to `centralus`
(`../worktrac_SDLC_setup_guide.md`, section 4.1). Container Apps, Log Analytics and the rest stayed in
East US. Re-checked 2026-11-20 through the capabilities API: East US and East US 2 still answer
"Provisioning is restricted in this region", with an exception available by support request
("Service and subscription limits"). Central US is open.

How the ~25-35 ms per trip was established:
- `/me` alone in production took 285-359 ms for ~10 trips; the same request locally, with the
  database on the same machine, 35-46 ms.
- The fastest logged 2-trip "prepare" lap of a History sync in production was 71 ms.
- Prod's app connections arrive from the app's own outbound IP (`sys.dm_exec_connections`), so nothing
  sits in between. The server's connection policy is `Default`.

## CPU: the app-open burst

Opening the app sends about 25 requests within ~2 seconds (taken from lower's per-request log):
`/me`, roster, exercises and tags once, and for every person their live session, History window,
routines, exercise list and a History sync.

Replayed locally (`scripts/diagnostics/app-open-burst.sh`): today's backend jar in Docker with a CPU
cap, prod's pool of 10 connections, the database on the same machine (so **no network at all**),
the burst six times at each size. Medians:

| CPU cap | Sync in the burst | Sync alone | Exercise list in the burst | Whole burst |
|---|---|---|---|---|
| 0.5 (prod since 2026-11-20) | 478 ms | 41 ms | 535 ms | 860 ms |
| 1 (lower) | 184 ms | 51 ms | 200 ms | 520 ms |
| 4 | 27 ms | 37 ms | 38 ms | 344 ms |

A request that takes 40 ms alone waits ~440 ms for CPU in the burst at 0.5 vCPU. A container's CPU
cap is enforced in 100 ms windows, so once the burst uses up a window's share, every thread waits for
the next one. That is the ~100 ms step seen in production's sync laps.

**Azure's CPU metrics cannot show this.** `CpuPercentage` is sampled per minute: the minute after an
app open reads 13-18% at most, because a ~1-second burst averages away inside 60 seconds. "CPU never
went above 20%" is therefore not evidence the burst isn't CPU-bound. The request times are.

Before this, prod ran 0.25 vCPU / 0.5 GiB: `/me` p50 410 ms, p90 1.8 s, max 6.4 s. It was resized to
0.5 vCPU / 1 GiB on 2026-11-20 (worktrac-deploy #98).

## The levers, in the order we'd pull them

| Lever | Removes | Cost | Risk |
|---|---|---|---|
| **Prod to 1 vCPU / 2 GiB** (`infra/prod.bicepparam`) | Most of the CPU wait: burst sync 478 -> 184 ms in the replay | ~$12/month more while idle | None; one-line deploy-repo PR to `production` |
| **Move the app to Central US** (a new Container Apps environment). **DONE 2026-11-20** | The network part of every request, app open or not | Same running cost | New app names ripple into Bicep, workflows, alerts and log queries. Managed certificates are per environment, so they are re-issued (a few minutes of TLS errors per hostname at cutover unless a certificate is brought). The `api.` hostnames stay, so iOS builds from 1.1.0, Stripe and Apple are untouched. **Two callers use the raw East US address and do need handling:** iOS 1.0.0 (build 9) and the email delivery webhook. Lower first. The step-by-step plan and every downside found: `region-move.md` |
| **Fewer requests per app open** (one start-up read per person instead of five) | The burst itself | A code project across client and server | API compatibility: additive endpoint, old builds keep the old calls (`api-compatibility.md`) |

Two smaller ones (each saves trips that now cost a few ms, so little is left to gain):
- **Skip the liveness check for recently used connections** (`com.zaxxer.hikari.aliveBypassWindowMs`
  above Hikari's 2-minute keepalive). One trip per request. A connection that died since its last use
  then fails one request, which a read's retry or the outbox absorbs.
- **Stop toggling auto-commit per transaction** (Hikari `auto-commit: false` +
  `hibernate.connection.provider_disables_autocommit: true`). Two trips per transaction. **Audit
  first**: any JDBC write that runs outside a Spring transaction (the outbox, ShedLock) would then be
  rolled back silently when the connection returns to the pool.

Moving the database to East US instead is possible only after Azure approves a support request, and
it moves the data (a write pause during the copy, new connection strings, firewall and Entra setup
redone) and changes the database's `create_date`, so every device re-downloads its History once
(`HistoryEpoch`). Moving the app moves nothing stateful.

## Monitoring: when to pull a lever

Production logs one timed line per app open (`AuthRequestLoggingFilter`'s `/me`) and a breakdown of
every History sync over 500 ms (`Slow History sync`). Per-request access logging is on in lower only.

```kusto
// Sign-in check (one per app open) and slow syncs, per day.
ContainerAppConsoleLogs_CL
| where ContainerAppName_s startswith 'worktrac-backend-prod' and TimeGenerated > ago(14d)
| where Log_s has 'GET /api/auth/me' and Log_s has '-> 200'
| extend ms = toint(extract(@'\((\d+) ms\)', 1, Log_s))
| summarize opens = count(), p50 = percentile(ms, 50), p90 = percentile(ms, 90), worst = max(ms)
    by bin(TimeGenerated, 1d)
| order by TimeGenerated asc
```

```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s startswith 'worktrac-backend-prod' and TimeGenerated > ago(14d)
| where Log_s has 'Slow History sync'
| summarize slow_syncs = count(),
    prepare_p50 = percentile(toint(extract(@'prepareMs=(\d+)', 1, Log_s)), 50),
    fingerprint_p50 = percentile(toint(extract(@'fingerprintMs=(\d+)', 1, Log_s)), 50)
    by bin(TimeGenerated, 1d)
```

Baseline after the 0.5 vCPU resize (2026-11-20, 2 users): `/me` p50 ~360 ms, worst 681 ms; slow
syncs ~600-700 ms during an app open.

Pull the next lever when, on a normal day:
- `/me` p90 goes over **1.5 s**, or its worst over **3 s** (a slow app open, not one request), or
- slow syncs climb past ~1 s, or a day has more slow syncs than app opens x people.

More users mean more overlapping bursts, so the CPU lever comes first. The `-response-time` alert
(average over 5 s for 15 minutes) is an outage alarm, not this; it will not fire for a slow-but-working
app.

## Re-measuring

- `scripts/diagnostics/db-round-trips.sh`: the trips one request sends, against a local stack.
- `scripts/diagnostics/app-open-burst.sh`: the burst replay at a given CPU cap.
- Query Store and the DMVs on prod and lower: `docs/azure-read-only-access.md`, "Reading the
  database's performance views".
