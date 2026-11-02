# Running the backend as several replicas

The backend runs on Azure Container Apps (ACA) behind one ingress, with no sticky sessions, and is
being moved from one replica to several. This page explains what each replica must not assume, and
the mechanism that replaced every assumption that used to hold.

The invariants a change must not break are in `.claude/rules/backend-core.md` ("The backend runs as
several replicas"). This page has the reasoning behind them.

## Sign-in was never the problem

Auth is a stateless JWT signed with the shared `APP_JWT_SECRET`. There is no `HttpSession`, no
cookie and no server-side session store, so any replica can serve any request. What breaks at more
than one replica is **state each JVM keeps in its own memory**. Each piece and its replacement:

| In-memory state | What goes wrong at N > 1 | Replacement | Status |
|---|---|---|---|
| Scheduled watchdogs | Each replica runs each job: duplicate audit rows and admin alerts, N× the Stripe calls | ShedLock (below) | Done |
| `AccountAccessService`'s 60s cache | Invalidation is local, so other replicas keep stale access, and a password change signs the person out | Token-newer re-read + DB invalidation log | Planned |
| Email and after-commit work in an in-process queue | Lost when a replica scales in, redeploys or crashes | Transactional outbox | Planned |
| Global email cap (Bucket4j, per JVM) | N× looser, and it refuses real sign-ups at 30/hour | Counted from the outbox | Planned |
| `TestCodeCache` (local/lower only) | e2e can't read a code from the replica that didn't send it | A DB table | Planned |
| Per-IP / per-email / per-account rate limits | Each limit N× looser | **Kept per replica, on purpose** (below) | — |

## Scheduled jobs: ShedLock

Spring's scheduler is per JVM, so every replica fires every `@Scheduled` method on its own timer.
ShedLock (`net.javacrumbs.shedlock`, Apache 2.0) makes each job run once per interval across all of
them, using a table the app already has access to. There's no new infrastructure.

- Each job has a row in `shedlock` (`name`, `lock_until`, `locked_at`, `locked_by`), keyed by its
  `@SchedulerLock(name = …)`.
- When a replica's timer fires, ShedLock runs one atomic `UPDATE … WHERE name = ? AND lock_until <=
  <db now>`, or an INSERT the first time. Exactly one replica's statement succeeds, and only that
  replica runs the body. The rest skip that tick.
- `lockAtLeastFor` keeps the lock for most of the interval even after a fast run. Without it, a
  replica whose timer fires a minute after the winner's would run the same sweep again.
- `lockAtMostFor` frees the lock if the winner dies mid-run. That interval's run is skipped; both
  watchdogs re-scan a time window on the next tick, so nothing is lost.
- `usingDbTime()` takes "now" from SQL Server, not from each container's clock, so clock skew
  between replicas cannot hand the lock to two of them.

| Job | Interval | lockAtLeastFor | lockAtMostFor |
|---|---|---|---|
| `RegistrationDispatchWatchdog` | 5 min | 4 min | 4 min 30 s |
| `SubscriptionReconciliationWatchdog` | 1 hour | 55 min | 59 min |

**Lower scales to zero.** At zero replicas nothing runs, which was already true before ShedLock.
Background threads don't count as HTTP traffic, so they never keep a replica awake.

## Rate limits stay per replica, on purpose

The Bucket4j limiters stay in memory, so each limit applies per replica:
- **Login per email:** a backstop. The real defence against password guessing is the DB account
  lockout (ten strikes), which is shared across replicas.
- **Login per IP and global:** these exist to protect CPU, and CPU is per replica.
- **Billing and import:** authenticated and per account, so being two or three times looser costs
  nothing.

The **global email caps** are the exception, because they protect the unauthenticated endpoints
(registration, password reset) and the email quota, which is shared. They move to a count from the
outbox. Per-IP filtering at the edge (Front Door + WAF) is Phase II.
