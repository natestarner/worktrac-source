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
| `AccountAccessService`'s 60s cache | Invalidation is local, so other replicas keep stale access, and a password change signs the person out | Token-newer re-read + DB invalidation log (below) | Done |
| Email and after-commit work in an in-process queue | Lost when a replica scales in, redeploys or crashes | Transactional outbox (below) | Done |
| Global email cap (Bucket4j, per JVM) | N× looser, and it refuses real sign-ups at 30/hour | Counted from the outbox, plus a warning level and pacing (below) | Done |
| `TestCodeCache` (local/lower only) | e2e can't read a code from the replica that didn't send it | The `test_codes` table, written in the issuing transaction | Done |
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

## The access cache: two halves, both needed

`AccountAccessService` caches, per (login, household), the membership, the role and the household's
plan for 60 seconds. It is consulted on every signed-in request, so without the cache every request
would cost a database round trip. Each replica has its own copy, which breaks two things:

1. **A freshly minted token can reach a replica that hasn't seen the change behind it.** Change your
   password on replica A; the next request, carrying the new token, lands on replica B, whose cache
   still holds the old token version. Refusing it answers 401, and the client treats any 401 as
   "signed out". An invite accepted on A has the same problem if B cached "no membership".
2. **A revocation, plan change or visibility change made on A doesn't reach B** until B's entry
   expires: a re-subscribed household stays paused, a revoked login keeps working, and a Pro owner
   hiding clients from each other still exposes them.

**Half (a): a token newer than the cache re-reads.** If the token's `tv` is higher than the cached
row's, or no membership is cached and the token's `iat` is no earlier than the second the entry was
read, the entry is re-read. A token that is merely *old* is still refused from memory. A revoked
device retrying forever costs nothing.

**Half (b): an invalidation log every replica replays.** Each `invalidate*` call clears the local
cache and also inserts a row into `access_invalidations` (user, account, or both). Every replica
replays the last 30 seconds of rows every ~2 seconds (`AccessInvalidationPoller`). It *replays* rather
than reading from a cursor, and that matters:

- The insert commits in its own transaction, possibly a moment before the change that caused it. A
  replica that reloads in that gap gets corrected on its next poll.
- An IDENTITY gap can't make a row get skipped.
- A replica that starts mid-window still picks the row up.

The cost is about 15 re-reads of each affected membership. Invalidations happen a handful of times
a day. If the table is unreachable, the 60s TTL still bounds staleness, which is how every replica
behaved before.

(a) alone leaves revocations stale for a minute. (b) alone leaves a ~2s window in which a new token is
refused, which signs the person out. Rows are purged after an hour (ShedLock'd).

`AccessCacheAcrossReplicasTest` builds a second `AccountAccessService` on the same database (its own
cache, as a second JVM would have) and pins each case, with a control showing the second replica *is*
stale without a poll.

## Email and other after-commit work: the transactional outbox

Every email, and the Stripe cancellation after an account deletion, used to exist only in memory
between the commit that caused it and the send. It sat in an `@Async` task in a 200-slot
in-process queue, or in an `afterCommit` hook. A replica that scaled in, redeployed or crashed in
that window lost it, with nothing anywhere saying it had been owed. With replicas coming and going,
that window is routine.

**Now the business transaction writes a row to `outbox`** (`outbox.Outbox.enqueue`), so the work
commits or rolls back with the change. The event listeners became synchronous `@EventListener`s
for exactly this reason: they run inside the publisher's transaction.

| Step | What happens |
|---|---|
| Commit | The writing replica tries the row at once on `emailTaskExecutor`, so a code still arrives in seconds |
| Claim | One atomic `UPDATE … WITH (UPDLOCK, READPAST)` takes a 5-minute lease and counts the attempt. Concurrent claimers skip each other's rows, so any number of replicas can poll |
| Success | `SENT`, payload nulled. Deleted after 30 days |
| Failure | Backoff 30s, 1m, 3m, 5m (5 attempts in ~9.5 minutes), then `FAILED`, payload nulled, and the handler's give-up records the reason (the FAILED audit row, the contact row, the billing event) |
| Replica dies | The lease expires, and any replica's 5-second poll reclaims the row |

**What is removed automatically, and what is not.** Payloads are nulled on completion, because
they can hold a raw verification code or invite token, and are AES-GCM encrypted at rest until then.
SENT rows are deleted after 30 days. **FAILED rows are never deleted automatically**, and nothing is
dropped because a replica died.

**Delivery is at-least-once.** If a replica dies after ACS accepted an email but before the row is
marked SENT, the email goes out twice. That's the accepted trade: a rare duplicate instead of a
silent loss. It's also why one row is one side effect.

**Cost:** the insert is part of a transaction that was already happening, plus two small updates
per email and one filtered-index seek every 5 seconds per replica. It replaces the in-memory queue,
so memory use is about the same.

**At zero replicas (lower)**, a new email is still sent at once: the request that creates it is what
wakes a replica. Only a retry waits for the next wake-up.

## Rate limits stay per replica, on purpose

The Bucket4j limiters stay in memory, so each limit applies per replica:
- **Login per email:** a backstop. The real defence against password guessing is the DB account
  lockout (ten strikes), which is shared across replicas.
- **Login per IP and global:** these exist to protect CPU, and CPU is per replica.
- **Billing and import:** authenticated and per account, so being two or three times looser costs
  nothing.

The **global email caps** are the exception, because they protect the unauthenticated endpoints
(registration, password reset) and the email quota, which is shared. Per-IP filtering at the edge
(Front Door + WAF) is Phase II.

## The global email caps

`GlobalEmailCap` counts the user-facing `email.*` outbox rows queued in the last hour, across every
replica (an indexed range count, V88). It runs only on `/register`, `/resend-code`,
`/forgot-password` and `/resend-reset-code`. There are two levels:

| Level | Env var | Default | Effect |
|---|---|---|---|
| Warning | `APP_RATE_LIMIT_GLOBAL_EMAIL_WARNING_PER_HOUR` | 150 | Records `EMAIL_VOLUME_HIGH`, which alerts the admin at most once an hour (send-failure toggle). Refuses nothing |
| Hard cap | `APP_RATE_LIMIT_GLOBAL_EMAIL_SENDS_PER_HOUR` | 1000 | 429. **Keep it just below the hourly quota Azure Communication Services has granted** |

Admin alerts and Contact Us alerts don't count and are never refused. Contact Us keeps its own
limiter.

**Pacing.** `OutboxDispatcher` sends at most `APP_OUTBOX_EMAIL_SENDS_PER_MINUTE` (default 30, ACS's
default for a custom domain) emails a minute across all replicas. An email row due while the last
minute is full goes back for 10 seconds without spending an attempt. A burst therefore queues for a
minute or two instead of being throttled by ACS. Codes last 15 minutes, so the wait is harmless.
Raise all three numbers together after Azure raises the quota.
