---
paths:
  - "backend/src/main/java/**"
---

# Backend invariants

Applies to all backend production code. Subsystem-specific rules load alongside this one.

## Multi-tenancy — the core product guarantee

- The app keeps each person's workout data (exercises, sets, reps, history) **fully separate**.
  Every workout-related table scopes rows to a specific person, and **every query must filter by
  the active person**.
- Account scoping goes through `CurrentUser.accountId()`. The **only** deliberate exception in
  the whole app is `AdminController`/`AdminService`, which reads across every account on purpose.
  If you are writing a cross-account query anywhere else, it is a bug.

## Time

- Use the injected `Clock` bean (`config/ClockConfig.java`), **never `Instant.now()`**. This is
  what makes `rest_seconds`, session staleness, and rate limiting deterministically testable with
  `MutableClock`.

## Configuration rules

- CORS is configured globally in `CorsConfig.java` — **do not** add `@CrossOrigin` to individual
  controllers. Allowed origins come from the `CORS_ALLOWED_ORIGINS` environment variable, never
  hardcoded values. CORS is registered **per path**: a cross-origin call to any non-`/api/**`
  backend path needs its own registration here (`/actuator/health` already has one — it was
  missing once and silently broke the offline banner; see
  `docs/incidents/2026-07-28-offline-banner-go-back-online.md`).
- Never set `spring.jpa.hibernate.ddl-auto` to anything other than `validate`. Schema changes go
  in Flyway migrations, never manual DDL.
- `server.forward-headers-strategy: framework` is load-bearing — it makes `X-Forwarded-For`
  trusted so per-IP rate limits are actually per-user behind Azure Container Apps' ingress,
  not one shared bucket.

## Concurrency — the local database must match Azure SQL

- **`READ_COMMITTED_SNAPSHOT` is ON everywhere, and that is what makes a read-then-write
  transaction safe.** Azure SQL Database (lower, production) enables it by default; a SQL Server
  container does **not**, so `scripts/db.sh` sets it explicitly on every worktree database. Don't
  drop that step and don't create a local database around it — without RCSI, plain reads take
  shared locks, and a transaction that reads and writes the same table can deadlock against a
  concurrent copy of itself. `WorkoutSetService.insertSetAndDetectPr` (SELECT → INSERT → SELECT on
  `workout_sets`) did exactly that under a parallel e2e run. Different accounts don't save you:
  page locks cover rows the query never touched. See
  `docs/incidents/2026-08-13-e2e-parallel-flakiness.md`.
- A deadlock surfaces as a 500, which `shouldRetryWrite` treats as transient, so the durable outbox
  replays it and no write is lost. **That is the whole recovery story — don't add a retry at the
  backend.** A second retry mechanism next to the outbox is precisely what `resilience.md`'s
  "reuse the mechanism" table exists to prevent.

## Error handling

- `GlobalExceptionHandler` (`common/`) must answer **every** failure mode with an honest
  400/503/500. An exception that escapes it reaches the servlet container's `/error`
  re-dispatch, which re-runs the stateless security chain as anonymous and turns a benign
  failure into a **401** — which the frontend reads as "session invalid" and logs the user out.
  A DB/backend outage must always degrade to "queue and retry", never to "you are signed out".
  See `docs/incidents/2026-07-27-db-outage-forced-logout.md`.

## Validation strictness is a durability decision

The frontend's `shouldRetryWrite` retries every failure **except** a 4xx outside `{408, 429}`. So a
400 on an offline-capable write (log set, edit set, session note, favorite, create exercise) does
not merely reject that request — it **permanently discards** a write that may have been queued in
the durable outbox through an entire outage, with no retry and nothing to replay.

**Reject only what is genuinely impossible.** Where a payload is merely *stale* — sent by a client
whose cached state predates a change — prefer interpreting it over refusing it, and comment the
branch with what makes the interpretation exact. `WorkoutSetService#resolveMeasure` is the worked
example (`workout-data-model.md`).

This does not apply to online-gated (Tier-3) writes, which have no outbox behind them.

## Style

- Java: 4-space indentation, Spring Boot conventions.
