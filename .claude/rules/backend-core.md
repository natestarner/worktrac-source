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

### The account is no longer the whole boundary — `AccountAccess` is

An account can hold more than one login, so "is this row in my account?" is now only half the
question. `membership/AccountAccess` answers both halves and is resolved **once per request** by
`JwtAuthenticationFilter`, then passed explicitly — services take it as a parameter rather than
reaching into the security context, so the dependency stays in the signature and a test can build
one as a record literal.

- **Ask for a permission, never for a role.** `AccountRole.permissions()` is the *only* place in
  the codebase that turns a role into authority; everything else calls `AccountAccess.has(...)`.
  A second `role == OWNER` comparison anywhere is the bug — that map is what makes adding a
  `COACH` role a one-file change instead of a 36-call-site one.
- **Two person guards, and picking the wrong one is invisible.** `requireVisiblePerson` for reads,
  `requireWritablePerson` for writes. They replaced `requireOwnedPerson`, which was deleted with
  no compatibility shim precisely so every call site had to be re-classified by hand; if a rebase
  reintroduces that name, it will fail to compile rather than quietly reopening the hole.
- **Status codes carry meaning here.** Not in the account, or not visible → **404**, preserving the
  pre-existing property that a caller cannot distinguish "doesn't exist" from "not yours". Visible
  but not writable → **403**, because a 404 there is a lie the UI immediately contradicts.
- **⚠️ An endpoint keyed on a CHILD id still needs a person guard.** `PATCH /api/sets/{setId}`,
  `PATCH /api/sessions/{sessionId}` and friends prove tenancy by walking the FK chain up to the
  *account* — that says nothing about which person owns the row. Use the already-loaded
  `requireVisiblePerson(person, access, message)` / `requireWritablePerson(person, access, message)`
  overloads, passing the *caller's* not-found message (the caller was asking for a set, not a
  person). `WorkoutSetService.findDuplicate` is the same trap one step further removed: it resolves
  an idempotency key account-wide, so it must check the found row's person before returning it.
- **Every handler under `/api/**` carries `@RequiresPermission`**, enforced at build time by
  `HandlerPermissionCoverageTest`. Household-scoped permissions are checked declaratively by
  `PermissionInterceptor`; `personScoped = true` means a service guard does it; `anyMember = true`
  means any member of the account may call it. The exempt controllers are listed in that test with
  the mechanism that gates each instead.
- **`PermissionInterceptor` throws `ForbiddenException`; it must never `setStatus`/`sendError`.**
  `sendError` re-dispatches to `/error`, which re-runs the stateless chain as anonymous and turns
  the 403 into a **401** — read by the frontend as "signed out". **MockMvc cannot catch this**
  (no container-level error dispatch), so that guarantee is pinned by a Playwright assertion.

## Time

- Use the injected `Clock` bean (`config/ClockConfig.java`), **never `Instant.now()`**. This is
  what makes `rest_seconds`, session staleness, and rate limiting deterministically testable with
  `MutableClock`.

## Request correlation — the MDC keys are load-bearing

`RequestDiagnosticsFilter` (registered **first** in the chain) puts the browser's per-install
`X-Correlation-Id` into the SLF4J MDC as `cid`; `JwtAuthenticationFilter` adds `uid` once it has
resolved a principal. `application.yml`'s **`logging.pattern.level`** is what emits them.

- **There is no `logback-spring.xml` in this project, on purpose.** Adding one overrides Boot's
  default console pattern and silently drops both keys — every log line keeps printing, just
  without the ids, so nothing fails and correlation is simply gone. Carry the keys across if you
  ever add one.
- **The filter must clear the MDC in a `finally`.** Request threads are pooled, and a leaked id
  points triage confidently at the *wrong* session — worse than having none.
- **The id is untrusted input.** It reaches log lines, so the filter sanitizes to
  `[A-Za-z0-9_-]{1,64}` and drops anything else rather than letting an attacker forge log entries.
- **MDC does not propagate into `@Async` tasks.** The email listeners' lines carry no `cid`; they
  correlate through `contact_messages.alert_message_id` instead. That absence is expected.

This exists because nothing outside `/api/auth/**` logged anything identifying the caller, so a
Contact Us bug report could only be matched to the container logs by timestamp. Triage query:
`docs/azure-read-only-access.md`.

## Configuration rules

- CORS is configured globally in `CorsConfig.java` — **do not** add `@CrossOrigin` to individual
  controllers. Allowed origins come from the `CORS_ALLOWED_ORIGINS` environment variable, never
  hardcoded values. CORS is registered **per path**: a cross-origin call to any non-`/api/**`
  backend path needs its own registration here (`/actuator/health` already has one — it was
  missing once and silently broke the offline banner; see
  `docs/incidents/2026-07-28-offline-banner-go-back-online.md`).
- Never set `spring.jpa.hibernate.ddl-auto` to anything other than `validate`. Schema changes go
  in Flyway migrations, never manual DDL.
- **`server.forward-headers-strategy` is `none` — do not set it to `framework`/`native`.** Both
  trust the *first* (leftmost) `X-Forwarded-For` entry, and Azure Container Apps appends its own
  observed IP to whatever a caller already sent rather than replacing it, so the leftmost entry is
  exactly the value an external caller controls. `security.ClientIpResolver.resolveClientIp` is
  the only correct way to get the real client IP: it reads the raw header itself and takes the
  *last* entry, the one hop ACA vouches for. Every per-IP rate limiter and IP-bearing log line goes
  through it — never `request.getRemoteAddr()` directly. See
  `docs/incidents/2026-08-31-xff-spoofing-bypassed-per-ip-rate-limits.md`.

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
