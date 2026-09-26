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
- **⚠ A permission an interceptor CANNOT decide must be annotated with the weaker one and refused
  in the service — and `HandlerPermissionCoverageTest` will not notice if the service half is
  dropped.** `PUT /api/exercises/{id}` and `PUT /api/tags/{id}` carry
  `EDIT_OWN_SHARED_RESOURCE`, which every member holds, precisely so the interceptor lets them
  through: it cannot know who created the row behind an `{id}`.
  `AccountAccess.mayEditSharedResource(createdByUserId)` is what actually refuses, and the coverage
  test asserts only that an annotation is **present**, never **which**. So deleting that service
  check fails nothing and silently hands every member the household's whole catalog.
  `MemberPermissionsTest`'s shared-resources block is the only thing pinning it — verified
  non-vacuous by removing the check.
- **Creator stamps (`exercises.created_by_user_id`, `tags.created_by_user_id`) are set once, at
  construction, and never transferred.** Neither entity has a setter, and neither dedup branch in
  `ExerciseService.add` (nor the find branch of `TagService.getOrCreate`) re-stamps the row it
  returns: an offline replay of a create is not a claim of authorship, and re-stamping would move
  who may rename it. A **null** stamp fails **closed** for a member and stays editable by the owner
  through `EDIT_ANY_SHARED_RESOURCE` — see `V67`'s comment for the three ways a null legitimately
  arises.
- **Every path that can create a shared resource must stamp it, and there are four**, not the two
  the endpoints suggest: `ExerciseService.add`, `TagService.getOrCreate` (reached from
  `PersonExerciseService.setTags` **and** the importer), and `CsvImportService.write`, which invents
  exercises for names the household does not have. That last one is why `write` takes an
  `AccountAccess` rather than a bare `accountId`.
- **⚠ A member may rename a shared resource only while nobody ELSE is using it, and the refusal is
  a 409, not a 403.** An exercise or tag is household-wide, so its name is the label on everyone's
  history; having created it does not make it yours forever. `ExerciseService.update` and
  `TagService.rename` check
  `existsByExercise_IdAndPerson_IdNot` / `isTagAppliedByAnotherPerson` against
  `AccountAccess.requireSelfPersonId()`.
  - **"Unused" means nobody OTHER than you** — deliberately not "no rows at all". Using your own
    exercise must not cost you the ability to fix your own typo; the harm is relabelling somebody
    else's history.
  - **The OWNER is exempt** (`EDIT_ANY_SHARED_RESOURCE`), and that is load-bearing rather than
    incidental: they are the remedy the refusal points at. Block them and the message has nobody to
    send you to.
  - **403 and 409 are different diagnoses and must not be collapsed.** 403 is "not yours"; 409 is
    "yours, but in use". They point at different fixes, and only 409 has a remedy to offer.
    `MemberPermissionsTest` pins them apart.
  - **`requireSelfPersonId()` throws rather than returning null**, because a null person would make
    `person_id <> ?` match every row and report "used by nobody" — waving through exactly the
    rename the check exists to refuse. Failing open is the one direction that must not happen.
  - Safe to refuse at all only because rename is a **gated (online-only)** write; a definitive 4xx
    on a durable write would be discarded, not shown.
- **⚠ Delete follows the SAME shape as rename for tags, but NOT for exercises.** A member may
  delete a tag they created once nobody else is using it — `DELETE_OWN_SHARED_RESOURCE` +
  `AccountAccess.mayDeleteSharedResource` + `TagService.delete`'s own
  `isTagAppliedByAnotherPerson` check, same 403-then-409 ordering as rename and for the same
  probing reason. **Exercises have no member-facing delete at all** — `ExerciseController`'s
  `DELETE` still carries only `DELETE_SHARED_RESOURCE` (owner-only, unconditional, no ownership
  or in-use check, exactly as it always was). Don't generalize the tag rule onto exercises without
  that being a deliberate decision: `DELETE_OWN_SHARED_RESOURCE` is a **narrower** grant alongside
  `DELETE_SHARED_RESOURCE`, not a replacement for it, and `TagDto.deletable` is the server's own
  precomputed answer to "would DELETE succeed for me right now" so the client never re-derives
  authorship/in-use from raw ids.
- **⚠ `ExerciseDto`/`PersonExerciseDto` carry the rename-side twin of `TagDto.deletable`.**
  `renamable` answers "would `PUT /api/exercises/{id}` succeed for me right now" and reproduces
  **all three** of `ExerciseService.update`'s gates; `createdByName` + `createdByYou` answer "who
  added this". Three things about them are load-bearing:
  - **`ExerciseAttributionResolver` is the single derivation, and it is BATCHED.**
    `ExerciseService.list` maps the whole visible catalog, so asking either question per row is an
    N+1 across several hundred rows. Both lookups run once, before the mapping — keep every call
    to it **outside** the `.stream()`. The in-use query is skipped entirely for an owner (exempt
    via `EDIT_ANY_SHARED_RESOURCE`) and asks only about the household's OWN ids, never the ~200
    global rows that are unrenamable by definition.
  - **It MIRRORS `update`'s gates rather than sharing code with them.** The service still refuses
    on its own terms, so a drift refuses the write and shows the server's message — the safe
    direction. Both are pinned in `MemberPermissionsTest`.
  - **`createdByName` is a NAME and nothing more**, exactly like `MembershipDto.ownerName`, and
    resolves through one `AccountMembershipRepository.findPersonNamesByUser` per list call. Null is
    legitimate — a global row, V67's three null-stamp cases, or a **revoked login**, whose rows lose
    their name because revoke deletes the only membership linking that user to a person here. Every
    consumer renders that as naming nobody.
  - `ExerciseService.list` takes an **`AccountAccess`**, not a bare `accountId`, because its rows
    now carry a per-login answer — same reason `CsvImportService.write` does.
- **`MembershipDto.ownerName` is resolved for MEMBERS only.** An owner does not need telling who
  the owner is, and resolving it for them would add a query to `/me` — the hottest endpoint in the
  app — for every existing user, all of whom are owners. It is a NAME and nothing more: no email,
  no id, nothing a member could act on outside the app. Null is legitimate (no owner membership, or
  one with no person) and every consumer must render that as naming nobody rather than "null".
- **⚠ Neither creation path may ever throw on a permission.** `ExerciseService.add` and
  `TagService.getOrCreate` deliberately contain no check at all: MEMBER holds
  `CREATE_SHARED_RESOURCE` unconditionally, so the annotation is the whole gate. These are durable
  writes, and `shouldRetryWrite` treats a definitive 4xx as terminal — a 403 here would discard the
  create permanently along with every set queued behind its temp exercise id. Same argument as the
  quota check's placement after both dedup branches; do not add one above them.
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

## Queries must survive years of history

Every test seeds a handful of sessions; a daily lifter has ~365 a year. Two shapes pass every
small test and break at that scale. `HistoryScaleTest` seeds 2,150 sessions to guard both.

- **Never bind an id list that grows with a person's history** (`findBy..._IdIn(sessionIds)`).
  SQL Server refuses a statement with more than **2,100 parameters**, so it fails outright, not
  slowly — History and CSV export both returned 503 past ~2,100 sessions until they were re-keyed
  on the person (`SessionExerciseNoteRepository#findBySession_Person_Id`). Key on the owner and
  group in memory, or join.
- **A whole-history load must fetch the associations its callers read per row.**
  `WorkoutSetRepository`'s two whole-history methods carry `@EntityGraph(attributePaths =
  "session")` because every caller reads `session.startedAt`; without it that was one lazy SELECT
  per session (~2,000 statements per `/prs` or trends request). Use a per-method graph, not a global
  `hibernate.default_batch_fetch_size`, which changes every lazy load in the app.
- **Ordering by a timestamp needs an id tie-break.** Two workouts can start at the same instant (an
  import with equal date and time; a frozen test clock), and without one their order is whatever the
  query plan returns — adding an index (V82) once flipped CSV export's. `WorkoutRowProjection` and
  `HistoryMonths` both break ties by id.
- History's transfer is gzip (`server.compression`).

## History is synced a month at a time — the fingerprint must cover every input

The app reads History through `POST /api/people/{id}/history/sync`: the client sends the
fingerprint of each month it holds, and gets back only the months whose fingerprint changed.
A month the client holds is trusted **for as long as its fingerprint matches**, so a change that
does not move the fingerprint is a device showing stale History until the daily full sync. Full
narrative: `docs/architecture/history-sync.md`.

- **The fingerprint is `COUNT` + `SUM(row_version)` per month** over the visible sessions, sets and
  notes, plus the `row_version` of every exercise the month's sets name, plus a full-history flag
  (`HistoryFingerprints`). `row_version` is a SQL Server `ROWVERSION` (V81): the **database** stamps
  it on every insert and update, so there is no write path — JPA, native SQL, import, a cascade —
  that can forget to bump it. That is what made this safe where #337 rejected a "version-stamp ETag".
  **Never replace it with an app-maintained `updated_at`.**
- **`SUM`, not `MAX`.** A transaction that commits late holds a row_version lower than rows already
  visible; MAX misses it, SUM does not. Every added value is greater than every removed one, so any
  change — including "delete one, add one" at the same count — moves the sum.
- **Hash the full-history flag, never the Free floor.** The floor is `now - 90 days` and moves every
  instant. Only rows it admits are aggregated, so a workout aging out lowers its month's count.
- **⚠️ If History ever reads a new column or table, fold it into BOTH fingerprint computations** —
  the aggregate (`HistoryFingerprints`) and the per-row totals (`HistoryMonths`). History carries
  exercise *names*, which is why `exercises` has a row_version at all.
  `HistoryFingerprintTest#everyFieldHistorySendsIsCoveredByTheFingerprint` fails on a new DTO field
  until it is declared covered; every other test there asserts that no month's History content
  changed without its fingerprint changing, and that the two computations agree.
- **Changed months are built in ONE statement** (`HistoryMonths`, a `UNION ALL` of sessions, sets and
  notes with their row_versions), and each month's fingerprint is summed from exactly those rows.
  Under RCSI one statement is one snapshot, so content and fingerprint cannot disagree. Splitting it
  into per-table loads reintroduces a phantom (a set added and deleted mid-load) paired with a
  fingerprint the client would then trust.
- **Every month the client KEEPS is re-checked after the load; a mismatch is a 503**, which the
  client's ordinary query retry answers. It is not a backend retry loop, and must not become one
  (see Concurrency above).
- **A device holding nothing gets one load and no fingerprint queries**: nothing it holds could be
  affected by either. **A range load seeks each of the range's workouts**, never the person's whole
  set range, so a one-month sync does not grow with the History. `HistorySyncCostTest` pins that.
- **⚠️ Both statements must cost in proportion to the PERSON, never the table.** The indexes (V83)
  cover every column they read, exercises are looked up by the person's distinct ids, and the join
  hints **and `HistoryPlanSize`** are load-bearing. Each size class of History gets one cached plan,
  and all three of these came from lower:
  - **The class marker sits inside the statement, after `WITH`.** Query Store ignores a leading
    comment, so a marker there made every class one Query Store query.
  - **Runtime feedback is off** (`NO_RUNTIME_FEEDBACK`). With it on, a reused plan ran a five-year
    History in ~57s; with it off, about 3s.
  - **Never `OPTION (RECOMPILE)`.** It held lower's CPU at 100% for 35 minutes compiling.

  `HistorySyncCostTest` fails if a person reuses another size class's plan, if a repeat run
  compiles anything, and on any scan or key lookup. **Add a column → add it to the index in a new migration.** Timing it locally
  proves nothing: 0.3s here was 10 minutes at 100% DTU on lower
  (`docs/incidents/2026-09-25-history-full-sync-pegged-lower-db.md`).
- **`GET /history` is the same builder, flattened** — for API readers and installed clients that
  predate the sync. Not a second implementation; don't let it grow one.
- **A month is the UTC calendar month of `started_at`**, computed by the database
  (`CONVERT(CHAR(7), started_at, 126)`). The client never computes one. Pass instants to native
  queries as UTC `LocalDateTime`s, never `java.sql.Timestamp` (which the JVM's zone would shift).
- **The property is tested directly, not just case by case.** `HistoryConvergenceTest` runs seeded
  random sequences of every History write (plan flips and clock aging included) against five
  simulated devices at different staleness, and after each write requires one sync to leave each
  holding exactly `GET /history`; it also asserts every write kind was actually *accepted*, so it
  cannot pass on a stream of refusals. `HistoryConcurrencyTest` does it under contention and requires
  every state a device reached to converge in one quiet sync. Replay or lengthen with
  `-Dhistory.convergence.seed=… -Dhistory.convergence.steps=…`.
- **⚠️ The shared integration-test databases do NOT enable `READ_COMMITTED_SNAPSHOT`**, unlike Azure
  SQL and local dev. `HistoryConcurrencyTest` turns it on for its own database because the
  one-statement load's consistency is exactly what RCSI provides; any test whose claim depends on
  RCSI must do the same, or it is testing a database production doesn't run.
- **`POST /history/drift` is the production canary** — a device's daily full sync found a month whose
  fingerprint matched while its content did not. It only logs (`History drift:` at WARN, month ids
  only). If it ever appears in the logs, a History input is missing from the fingerprint.
- **Auto-close is not a write until something writes.** `GET /sessions/live` computes it read-only,
  so History (and the fingerprint) change only when the next set's write saves it —
  `HistoryFingerprintTest` pins both halves.

## Error handling

- `GlobalExceptionHandler` (`common/`) must answer **every** failure mode with an honest
  400/503/500. An exception that escapes it reaches the servlet container's `/error`
  re-dispatch, which re-runs the stateless security chain as anonymous and turns a benign
  failure into a **401** — which the frontend reads as "session invalid" and logs the user out.
  A DB/backend outage must always degrade to "queue and retry", never to "you are signed out".
  See `docs/incidents/2026-07-27-db-outage-forced-logout.md`.

- **⚠️ On an already-authenticated route, `UnauthorizedException` (401) means ONE thing: this
  token itself is no longer valid.** `api/client.js` reads it that bluntly on purpose — any 401
  on a request that carried a bearer token clears it and force-navigates to `/login`, with no
  per-route opt-out. That is correct for a stale/revoked token and wrong for anything else, so an
  authenticated endpoint that separately checks a SECOND credential (a current password, say)
  must never throw `UnauthorizedException` for that check failing — the token is fine, and 401
  there silently signs the person out over a wrong answer to a question that had nothing to do
  with their session. Use `ForbiddenException` (403) instead, the same way the sibling lockout
  case on that same check already uses `LockedException` (423) rather than colliding on 401.
  `PasswordChangeService`'s wrong-current-password branch is the worked example; see
  `docs/incidents/2026-09-09-change-password-wrong-current-signs-out.md`.

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
