# Workout Tracker

## Project Overview
React frontend + Java Spring Boot microservices backend, deployed to Azure via GitHub Actions.
Tracks workouts (exercises, sets, reps) for multiple people (Nate and his sons) from one
household, with each person's data kept separate. Optimized for iPad and iPhone use during
workouts.

## Pipeline & Setup History
The full SDLC/DevOps setup guide — covering the reasoning behind CI/CD design, custom
domains, branch protection, security scanning, and fixes like the deploy-time config.json
correction and the testcontainers-bom / Docker Engine version pin — lives one level up at
`../worktrac_SDLC_setup_guide.md`. It is NOT inside this repo, so open the parent folder
in VS Code (rather than this repo alone) if you need that context. Check it for the "why"
behind existing pipeline/infra configuration before changing it.

## Tech Stack
- Frontend: React (JavaScript), served by Azure Static Web Apps
- Backend: Java 25, Spring Boot 4.x, Maven
- Database: Azure SQL (SQL Server) — local dev uses SQL Server in Docker
- CI/CD: GitHub Actions, GitHub Container Registry (GHCR)
- Hosting: Azure Container Apps (backend), Azure Static Web Apps (frontend)

## Key Directories
- `frontend/` — React application
- `backend/` — Spring Boot application
- `backend/src/main/resources/db/migration/` — Flyway SQL migrations
- `e2e/` — Playwright end-to-end tests
- `.github/workflows/` — CI/CD pipelines

## Common Commands
```bash
# Local development
cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=local
cd frontend && npm run dev
cd e2e && npx playwright test

# Run backend tests
cd backend && mvn verify

# Run frontend tests
cd frontend && npm test

# Start local SQL Server (host port 1434 — see note below)
docker start worktrac-sqlserver
```

## Local SQL Server Port
This machine already runs another project's SQL Server container (`inttime-sqlserver`) on
the standard host port 1433. `worktrac-sqlserver` is mapped to host port **1434** instead
(`-p 1434:1433`). `application-local.yml` points at `localhost:1434` accordingly — don't
"fix" this back to 1433.

## Code Standards
- Java: 4-space indentation, follow Spring Boot conventions
- JavaScript/React: 2-space indentation, ESLint + Prettier
- SQL migrations use T-SQL syntax, NOT MySQL/Postgres:
  - IDENTITY(1,1) not AUTO_INCREMENT
  - NVARCHAR not VARCHAR
  - BIT not BOOLEAN
  - GETDATE() not NOW()
  - DATETIME2 not TIMESTAMP
  - TOP(n) not LIMIT n
  - ISNULL() not IFNULL() or COALESCE() (though COALESCE works in T-SQL too)
- CORS is configured globally in CorsConfig.java — do not add @CrossOrigin to individual controllers
- Allowed origins come from the CORS_ALLOWED_ORIGINS environment variable, not hardcoded values
- Database schema changes go in Flyway migration files, never manual DDL
- Never set `spring.jpa.hibernate.ddl-auto` to anything other than `validate`

## Data Model Notes
- The app must keep each person's workout data (exercises, sets, reps, history) fully
  separate — every workout-related table should scope rows to a specific person, and
  every query must filter by the active person.
- **`workout_sets.rest_seconds`** (added in `V17__add_rest_seconds_to_workout_sets.sql`)
  records how long a person rested before a given set, for the Trends "rest between
  sets" feature. The full rule lives in `WorkoutSetService.java`
  (`logLiveSet`/`logSetIntoSession`/`computeRestSeconds`) and `WorkoutSet.java`, but the
  invariants any future change must preserve are:
  - **Null unless the set was logged through the live-session endpoint**
    (`POST /api/people/{personId}/live-sets` → `WorkoutSetService.logLiveSet`). Anything
    logged through `POST /api/sessions/{sessionId}/sets` (`logSetIntoSession`) always gets
    `null` — **do not** gate this on the session's `manual` flag instead. `manual` only
    catches sessions created via the retroactive "Log a past workout" flow; it misses an
    old, originally-*live* (`manual = false`) session being resumed via History's "Edit"
    button to append a forgotten set days later, which is exactly as untrustworthy for
    rest-time purposes. Gating on which endpoint handled the write catches both cases,
    because `logSetIntoSession` is *only* ever called when the frontend is in that
    explicit "editing a specific existing session" mode (see
    `frontend/src/components/log/ExerciseDetail.jsx`'s `handleLogSet`), never for
    real-time logging.
  - Null for the first set of an exercise in a session (nothing to diff against).
  - Otherwise, computed once at insert time as the gap between this set's effective logged
    time and the most recent prior set's `created_at` for the *same session + same exercise*
    — scoped by exercise, not just session, so supersetting into a different exercise between
    sets doesn't corrupt the number.
  - **"Effective logged time" is the client's `clientLoggedAt` when the request supplies it,
    otherwise the server `Clock`.** A live-set write now carries the moment it actually
    happened, and `created_at` honors it — so a set logged now but synced later (retry after a
    dropped response, or a future offline replay) keeps an honest `created_at` and therefore an
    honest rest gap, instead of measuring the sync moment. When `clientLoggedAt` is absent
    (older/other callers) it falls back to the `Clock`, so the invariant below and
    `RestSecondsTest` are unaffected.
  - **Immutable after insert**, by construction: `WorkoutSet.restSeconds` has no setter.
    Editing a set's weight/reps (`editSet`) must never touch it, and deleting or editing
    a neighboring set does not retroactively recompute it — it's a snapshot of what
    actually happened at the time, not a live-derived value.
  - Computed from the app's injected `Clock` bean (`ClockConfig`), not `Instant.now()`,
    so it's deterministically testable with `MutableClock` (see `RestSecondsTest.java`),
    matching the same pattern `WorkoutSessionService` uses for its 8-hour staleness rule.
- **Log-set idempotency (`workout_sets.client_key`, added in `V40`/`V41`).** The log-set
  request carries an optional client-generated `idempotencyKey`; `WorkoutSetService.findDuplicate`
  returns the already-committed set (with `isPR = false`) instead of inserting a second row, so a
  retried or offline-replayed write can't double-log. A unique filtered index backstops the
  concurrent case. Blank/absent key ⇒ no dedup. This is what makes the frontend's optimistic
  log-set + retry safe. **Correcting a set's weight/reps must never be expressed as a re-dispatch
  of its create under the same `idempotencyKey`** — `findDuplicate` returns the already-committed
  row regardless of the new payload, so a same-key edit-via-recreate is silently discarded if the
  original create already landed. See the "editing a still-queued offline set" Resolved Incident
  below: an edit is always a genuinely separate `EDIT_SET` write, never a mutation of the create.
- **Rest-timer display preference (`people.rest_timer_enabled`, added in `V39`).** A per-person
  setting, but persisted account-side (not per-device localStorage) and surfaced on each person in
  `/api/auth/me`, so Settings shows every person's toggle at once and it syncs across devices. Set
  via `PUT /api/people/{personId}/rest-timer-preference`. Display-only: `rest_seconds` is recorded
  regardless. A one-time client migration (`lib/restTimerMigration.js`) carries any legacy
  localStorage value up on first load.
- **Exercise notes** are two independent, coexisting features — don't conflate them:
  - **Persistent note** (`person_exercise.note`, added in
    `V35__add_note_to_person_exercise.sql`) — a standing per-person reminder shown every
    session for that exercise (e.g. "keep elbows tucked"). Set via
    `PersonExerciseService.setNote` / `PUT /api/people/{personId}/exercises/{exerciseId}/note`.
    Isolated per person the same way `is_favorite` already is. A note (like favoriting)
    also puts the exercise in the person's Log picker (`PersonExerciseService.listForPerson`
    — picker = favorites UNION noted UNION logged) even if it was never favorited or
    logged: without this, the frontend's `personExercises.find()` would miss it and fall
    back to the note-less catalog DTO, making a just-saved note invisible on screen.
  - **Session note** (`session_exercise_notes` table, added in
    `V36__create_session_exercise_notes.sql`) — scoped to one workout, keyed on
    `(session_id, exercise_id)`. Managed by `SessionExerciseNoteService`
    (`com.worktrac.backend.sessionexercisenote`). Two write paths mirror the
    `logLiveSet`/`logSetIntoSession` split above: `PUT
    /api/people/{personId}/live-exercise-notes` calls
    `WorkoutSessionService.getOrCreateLiveSession` first, so a note can be saved *before
    any set is logged* in a workout; `PUT
    /api/sessions/{sessionId}/exercises/{exerciseId}/note` targets an explicit (typically
    past) session directly. The previous session's note is surfaced back via
    `StatsService.getLastSession`'s `LastSessionDto.note` (the "Last time" card) and via
    `WorkoutSessionService`'s History DTOs (`HistoryEntryDto.note`).
  - **Both types: a blank/whitespace-only save deletes the underlying row** rather than
    storing an empty string, so "has a note" can be tested by row presence alone — don't
    special-case empty strings anywhere downstream.

## Auth Notes
- **Password reset (`POST /api/auth/forgot-password`, `/reset-password`,
  `/resend-reset-code`) is deliberately non-enumerating** — see `PasswordResetService.java`.
  Requesting a reset for an email with no account must return the exact same response as a
  registered one: same `200`, same generic body, and it must consume the same rate-limit
  quota (`checkSendAllowed` runs *before* the `existsByEmail` check, not after — gating it
  only on the known-email branch would let an attacker distinguish "known" from "unknown" by
  which emails eventually 429 under repeated requests). Any future change to this flow
  (new error message, a "no account found" UI state, etc.) must preserve that indistinguishability.
- **Registration is fully audited** (`registration_events` table, `V44`,
  `com.worktrac.backend.registrationaudit` package) — see Admin Portal Notes below for what
  this makes visible and how email delivery truth is captured end-to-end.

## Admin Portal Notes
- **`ADMIN_EMAILS` (an env var wired per-environment in the `worktrac-deploy` repo) is the
  real source of truth for who is an admin** — `users.role` (`'USER'`/`'ADMIN'`) is only a
  cache of it, never edited by hand. It's reconciled in two places:
  - `AuthService.login` — promotes or demotes on every login, so removing someone from the
    allowlist takes effect on their next login without a redeploy.
  - `AdminBootstrap` (an `ApplicationRunner`) — promotes any already-registered listed user
    once at startup, so a freshly added `ADMIN_EMAILS` entry doesn't require that person to
    log out and back in first. It never demotes; only login does.
  - `RegistrationService.confirmEmail`'s auto-login does **not** reconcile — a brand-new
    admin-allowlisted registration is still `USER` until their first explicit `/api/auth/login`.
  - The JWT carries the role as a claim (`JwtService`); `JwtAuthenticationFilter` builds the
    Spring Security authority from it. A token minted before this claim existed parses with
    role defaulting to `USER`, not failing closed to `ADMIN` — never invert that default.
- **`/api/admin/**` is gated at the route level** (`SecurityConfig` → `hasRole("ADMIN")`),
  not per-controller-method — `AdminController`/`AdminService` are the one place in the app
  that deliberately reads across every account instead of scoping to
  `CurrentUser.accountId()`. Admin DTOs must never include `password_hash`,
  `pending_registrations.code_hash`, or any hashed value — curate every field added to them.
- **Read-only, with exactly two narrow, sanctioned exceptions** (any future admin action that
  touches app data needs the same explicit sign-off these two got):
  1. `PUT /api/admin/registration-alert-settings` (below) — alerting *configuration*, not
     application data.
  2. `DELETE /api/admin/test-data` (below) — genuinely deletes rows, but only ones matching the
     e2e suite's own exact, unmistakable email pattern; see its own entry for the full safety
     design.
- **Registration observability (`registration_events` table, `V44__create_registration_events.sql`,
  `com.worktrac.backend.registrationaudit` package) — added 2026-07-31 after a production
  registration silently failed with zero trace anywhere.** Every step of the registration
  lifecycle — form submitted, duplicate/rate-limited/locked/expired/wrong-code, confirmed +
  account created, and the email outcome — is persisted as a `RegistrationEvent`
  (`RegistrationAuditService.record`, called from `RegistrationService` and
  `RegistrationEmailEventListener`). `REQUIRES_NEW` on `record()` is load-bearing: several
  failure branches record-then-throw from a transaction that is NOT `noRollbackFor`-exempted
  (unlike `confirmEmail`'s wrong-code branch), so without its own independent transaction the
  audit row recording the very failure would be rolled back along with everything else.
  Surfaced in the admin portal's **Activity** tab (full feed, `GET
  /api/admin/registration-events`, with a legend explaining event colors and the send-vs-delivered
  distinction) and folded into the **Pending** tab as a per-row email delivery-status badge +
  expired flag.
  - **A request to `/api/auth/register`/`confirm-email`/`resend-code` that never reaches
    `RegistrationService` at all is also captured**, as `RegistrationEventType.UNEXPECTED_ERROR` —
    a malformed body, a Bean Validation failure, a `DataAccessException`, or anything else
    `GlobalExceptionHandler` had to catch, with the real cause in `detail`. This does **not**
    cover a genuine full outage (DB down / container crashed) — recording an event is itself a
    database write, so if the database is unreachable there's nothing to record with; that class
    of failure is only visible via Azure's own Container App log stream. Extracting the email for
    this case needed `WebUtils.getNativeRequest(request, ContentCachingRequestWrapper.class)`, not
    a plain `instanceof` check — confirmed by a real test failure without it: Spring Security
    wraps the request in further layers between `AuthRequestLoggingFilter` (which populates the
    `ContentCachingRequestWrapper` in the first place) and `GlobalExceptionHandler`, so the object
    a `@ExceptionHandler` method actually receives is not that wrapper directly, only something
    wrapping it.
  - **Two levels of email truth, both captured, never conflated:** (1) *send accepted* —
    `EmailService.send` now inspects ACS's own `EmailSendResult.getStatus()`/`getError()`
    instead of discarding it, throwing `EmailSendException` with the real ACS code/message on
    anything but `SUCCEEDED`, and returns the ACS `messageId` on success. (2) *actually
    delivered* — the ACS send being accepted does **not** mean the recipient ever got it; that
    truth arrives later, out of band, via Azure Event Grid's
    `Microsoft.Communication.EmailDeliveryReportReceived` events, ingested by
    `EmailDeliveryWebhookController` (`POST /api/webhooks/email-delivery`,
    `com.worktrac.backend.emaildelivery` package) and correlated back to the original send via
    that same `messageId`. The webhook's `permitAll()` route (`SecurityConfig`) is gated
    instead by a shared-secret query param (`EMAIL_DELIVERY_WEBHOOK_KEY`, wired per-environment
    in `worktrac-deploy` — see `EmailDeliveryWebhookProperties`), since Event Grid is a
    server-to-server caller with no JWT. **Requires an Azure Event Grid subscription on the
    ACS resource pointing at this webhook to actually receive delivery reports** — set up for
    both lower (`worktrac-comms-lower-topic`) and production (`worktrac-comms-prod-topic`,
    added 2026-08-02 alongside the registration-observability feature's promotion to
    production) as of this writing; setup steps recorded in `../worktrac_SDLC_setup_guide.md`
    section 21. A future third environment would need the identical two-step
    `az eventgrid system-topic create` + `az eventgrid system-topic event-subscription create`
    (the dedicated subcommand — the generic `event-subscription create --source-resource-id`
    does not work against this resource type) against its own ACS resource before its
    `EMAIL_DELIVERED`/`EMAIL_BOUNCED`/etc. events would ever arrive.
  - **Every failure event's `detail` carries the real reason**, not just an event-type label:
    ACS error code/message for a send failure, the recipient server's actual SMTP diagnostic
    (`deliveryStatusDetails.statusMessage`, e.g. `"550 5.1.1 mailbox does not exist"`) for a
    delivery failure, and the specific cause (which rate limiter, attempt number, etc.) for a
    flow failure.
  - **Alerting is admin-configurable, not hardcoded** — `registration_alert_settings`
    (single seeded row, `V45__create_registration_alert_settings.sql`), three toggles (new
    registration confirmed / send failure / delivery failure — the latter two default ON,
    confirmed defaults OFF), read/written via `GET`+`PUT
    /api/admin/registration-alert-settings` and the Activity tab's settings panel.
    `AdminAlertEventListener` reacts to a `RegistrationAlertEvent` (published by
    `RegistrationAuditService.record` for the alertable subset of event types) and, if the
    matching toggle is on, emails every `ADMIN_EMAILS` address via
    `EmailService.sendAdminAlert`. An alert-send failure is logged only — there is no
    "alert about a failed alert" escalation.
  - **No admin "resend" action was added, on purpose.** A stuck pending registration isn't a
    real account yet (no `users` row), so re-registering the same email already works —
    `register()` only checks `users`, not `pending_registrations`, and replaces the stale
    pending row with a fresh code. Adding a resend button would have been redundant.
- **The async email-dispatch pipeline itself can never silently swallow a task — see the
  2026-08-01 blind-spots incident below.** `AsyncConfig`'s `emailTaskExecutor` uses
  `CallerRunsPolicy`, not the `ThreadPoolTaskExecutor` default (`AbortPolicy`, which silently
  throws/drops a task when the pool+queue are saturated with nowhere for a `@Async void`
  method's exception to go). `RegistrationEmailEventListener`'s four handlers (verification
  code, registration success, password-reset code, password-reset success — all four now
  covered identically, see below) isolate the SEND attempt from the AUDIT WRITE in separate
  try/catches (`sendAndRecord`/`recordSafely`): a failure while persisting the *SENT* audit row
  itself must never be misreported as the email having failed, since the send may have
  genuinely succeeded — conflating the two would falsely trigger a "send failure" admin alert
  for an email that actually went out. `AdminAlertEventListener` records `ADMIN_ALERT_FAILED`
  (not just a log line) if the alert email itself fails to send — deliberately not in
  `RegistrationAuditService`'s `ALERTABLE` set, since an alert about a failed alert would
  recurse. `RegistrationDispatchWatchdog` (`@Scheduled`, every 5 minutes, `SchedulingConfig`
  enables `@EnableScheduling` app-wide) is the last-resort safety net for failure modes nobody
  has specifically anticipated: it queries for any `REGISTER_STARTED` with no
  `VERIFICATION_EMAIL_SENT`/`FAILED` recorded within a 2-minute grace period and records
  `REGISTRATION_EMAIL_DISPATCH_MISSING` (alertable, reuses the `alertOnSendFailure` toggle) —
  this is what makes "no blind spots" actually true rather than true only for failure modes
  someone thought to `catch`.
  - **Password-reset emails (`PasswordResetService`) get the identical SENT/FAILED audit
    coverage** as registration emails (`PASSWORD_RESET_EMAIL_SENT/FAILED`,
    `PASSWORD_RESET_SUCCESS_EMAIL_SENT/FAILED`) — previously these had zero audit trail at all,
    only a bare `log.error`, which was itself an undiagnosed blind spot in a sibling flow.
- Frontend: `AdminRoute` redirects a non-admin (even if authenticated) to `/app/log` rather
  than showing an access-denied screen, so the portal's existence isn't revealed to ordinary
  users. It's a standalone layout (`AdminShell`) under `/admin`, not a tab inside the
  workout app's `AppShell`/`TabsNav`. Tabs: Overview, Accounts, People, Pending, **Activity**.
  `AdminShell` also mounts `Toast`/`ConfirmDialog` (unlike the rest of `AppShell`'s globals,
  which are workout-specific and irrelevant here) — needed by the test-data cleanup action
  below; without them, `openConfirm()`/`showToast()` called from an admin route would update
  `UIContext` state that nothing in the admin tree ever renders.
- **"Delete all e2e test data" (`DELETE /api/admin/test-data`, `com.worktrac.backend.admin`'s
  `TestDataCleanupService`/`TestDataAdminController`) — the second deliberate exception to the
  read-only-admin-portal rule.** Lets an admin wipe every trace of the Playwright e2e suite's
  own data on demand, from a button on the Activity tab, to clear the noise it leaves in
  Accounts/Pending/Activity.
  - **Identification matches two precise patterns, not a heuristic:** every one of this repo's
    e2e specs creates its test households through exactly one shared helper
    (`e2e/tests/support/auth.ts`'s `registerHousehold`), which always generates emails as
    `huddle+e2e-<timestamp>-<random>@starner.co` — a plus-addressed sub-address of a real mailbox
    the team controls, filed into its own folder by a mail rule on the `huddle+e2e-` prefix.
    **Switched 2026-08-02 from `e2e-<...>@example.com`**: that IANA-reserved (RFC 2606) domain
    could never resolve to a real mailbox, so *every* e2e-generated registration bounced —
    harmless to the app itself, but each bounce still counted against the sending domain's ACS
    reputation, and volume only grows as deploys get more frequent. A genuine user would need to
    both own `huddle@starner.co` and choose to register with this exact synthetic local part, so
    `TestDataCleanupService.CURRENT_EMAIL_PATTERN` (`huddle+%@starner.co` —
    `findAccountIdsByEmailLike`/`countByEmailLike` on `UserRepository`,
    `RegistrationEventRepository`, `PendingRegistrationRepository`) still can never accidentally
    match a genuine user's account. Deliberately broader than just the `huddle+e2e-` prefix
    (see below) so it also catches `live-email-canary.spec.ts`'s `huddle+livewiretest-...`
    address. `LEGACY_EMAIL_PATTERN` (`e2e-%@example.com`) is retained alongside it so any
    pre-2026-08-02 backlog already sitting in a database can still be cleaned up. **The e2e
    helper's pattern and both of `TestDataCleanupService`'s patterns must always change
    together** — they're independently-maintained copies of the same literal strings, not
    derived from one shared constant.
  - **Real ACS traffic from e2e is now a single, deliberate exception, not every registration.**
    `EmailProperties.e2eNoopRecipientPattern` (a regex, set only in `application-local.yml`/
    `application-lower.yml` — empty, and therefore inert, in production) makes
    `EmailService.send()` skip the real Azure Communication Services call entirely whenever
    every recipient matches it, returning a synthetic `"noop-<uuid>"` messageId instead.
    Everything above that one network call — `RegistrationEmailEventListener`,
    `RegistrationAuditService`, the Activity tab — still runs for real, so a no-op'd send is
    still fully visible in the audit trail as an ordinary `VERIFICATION_EMAIL_SENT`. The
    configured pattern only matches the `huddle+e2e-` prefix (not the whole `huddle+%@starner.co`
    cleanup namespace), so `e2e/tests/live-email-canary.spec.ts`'s `huddle+livewiretest-...`
    address deliberately falls through to a real send every time — the one spec proving the real
    registration → email pipeline still works end to end, since every other spec's registration
    is now free (no real ACS call, no real bounce/reputation exposure). That spec can't just
    check that the UI reached `/app/log` (the verification code is written to a local cache
    synchronously, independent of whether the async send that follows succeeds, fails, or gets
    no-op'd) — it polls a new test-support endpoint, `GET /api/auth/test/email-outcome`
    (`TestSupportController`, gated identically to the existing `pending-code` endpoint), which
    reads the real `VERIFICATION_EMAIL_SENT`/`FAILED` event back from `registration_events`.
  - **Genuine bulk SQL deletes, not a per-account loop — fixed 2026-08-01 after a real lower
    timeout.** An earlier version looped `AccountDeletionService.deleteAccount(Long)` once per
    matching account; Spring Data JPA's derived `deleteByAccount_Id`/`deleteByEmailLike` methods
    (used by that per-account cascade) load and remove every matching entity one at a time
    rather than issuing a single `DELETE` statement, so once lower had accumulated hundreds of
    e2e accounts across repeated deploys' e2e runs, one click took long enough to exceed the
    frontend's request timeout — and the client timing out did **not** cancel the still-running
    backend transaction, whose DB load is suspected to have contributed to the async
    email-dispatch blind spot described above. `deleteAll()` now issues one bulk
    `DELETE ... WHERE account_id IN (...)` (or `email LIKE ...`) per table across every matching
    account at once (`deleteByAccountIdIn` on `PersonRepository`/`ExerciseRepository`/
    `TagRepository`/`UserRepository`, `deleteByEmailLikeBulk` on
    `RegistrationEventRepository`/`PendingRegistrationRepository`, and Spring Data's own
    `deleteAllByIdInBatch` for `accounts`) — order still matters for the same FK reasons as
    `AccountDeletionService` (untouched, still the real single-account self-service-delete
    path). The frontend's `deleteTestData()` call also carries its own longer `timeoutMs`
    (60s vs. the shared 15s default, via `apiClient.delete`'s new options parameter in
    `client.js`) as a second line of defense.
  - **The real safety net is `TestDataAdminController`'s `@Profile({"local", "lower"})`** —
    identical two-layer defense to the e2e test-support endpoint (`TestSupportController`): these
    routes don't exist as Spring beans at all outside local/lower, so this can never run in
    production even by mistake, regardless of what the UI does or doesn't hide. Still gated by
    the existing `/api/admin/** → hasRole('ADMIN')` rule in `SecurityConfig` on top of that.
  - **Preview before delete, not just a generic confirm.** `GET
    /api/admin/test-data/preview` returns the same `AdminTestDataPreviewDto` (account count,
    registration-event count, pending-registration count) that the `DELETE` call itself
    returns, so the Activity tab's button shows the admin exactly what's about to go inside the
    shared global `ConfirmDialog` before they commit — a deliberate, discussed choice over a
    plain "are you sure?".

## Frontend State Notes
- **Every person has their own independent client-side state.** Whatever a person is
  currently doing or viewing — which tab/screen, selected exercise, routine position,
  draft weight/reps, exercise search text, an in-progress past-session edit, an active
  rest timer, etc. — must survive switching to another person and back. Nothing that
  represents "what this person is doing right now" should live as a single global value.
- This is the client-side mirror of the Data Model Notes above: the backend keeps each
  person's *data* separate; the frontend must keep each person's *in-progress UI state*
  separate too. Same principle, different layer.
- Implemented via three mechanisms:
  - **Server data → a `personId`-keyed TanStack Query cache** (`@tanstack/react-query`;
    client + query keys in `frontend/src/lib/queryClient.js` and
    `frontend/src/api/queryKeys.js`). Every read is a `useQuery` whose key includes the
    `personId` (account-shared reads — the exercise catalog, tags — deliberately omit it so
    they're fetched once and shared). Switching people reads a *different* cache entry, so
    Person A's data can't render under Person B. Writes are `useMutation`s that invalidate the
    right keys (single source of truth for the green "live session" dot + banner, PRs after a
    set, etc.). The cache is persisted to IndexedDB (`PersistQueryClientProvider`) and cleared
    on every auth change (`resetQueryCache`, since catalog/tags keys carry no accountId).
    Never construct query keys inline — always go through the `queryKeys` factory.
  - **Ephemeral per-person UI state → `AppStateContext`** (`frontend/src/context/AppStateContext.jsx`),
    now a `byPerson[personId]` map (each person's own slice; `activePersonId` selects which is
    live — no snapshot capture/restore). Covers current tab, selected exercise, routine
    position, weight/reps drafts, exercise search, in-progress past-session edit. Persisted per
    account to IndexedDB and rehydrated on load (first paint gated on it via `ProtectedRoute`),
    so an active routine survives a reload. Slices for removed people are pruned
    (`RECONCILE_PEOPLE`); the exposed context value still flattens the active slice to the top
    level, so consumers read `selectedExerciseId`/`weightDraft`/etc. unchanged.
    - **`lastTab` (current tab) is the one exception to "always restore where a person left
      off."** A mid-session reload must resume the persisted tab (`status` alone can't tell a
      reload apart from a fresh login — both land on `status === 'authenticated'`), but an
      actual login/registration must always land every person on Log, not wherever the
      previous session happened to be. `AuthContext.login`/`confirmEmail` set a `freshLogin`
      flag on their `setState` call (never set by the silent boot/reconnect paths); the
      `HYDRATE` reducer case in `AppStateContext.jsx` resets every restored person's `lastTab`
      to `/app/log` when it's set. Any future field that should behave like `lastTab` (reset on
      login, preserved on reload) should key off the same `resetTab`/`freshLogin` plumbing
      rather than inventing a second signal.
  - `UIContext` (`frontend/src/context/UIContext.jsx`) — state keyed by personId directly
    (e.g. `restTimers: { [personId]: {...} }`), used when a person's state needs to keep
    running independently in the background even while a *different* person is active
    (e.g. one person's rest timer must keep counting down while someone else takes their
    turn logging a set). Unchanged by the rework.
- **Freshness UX:** a cached view paints instantly; a small `RefreshingPill` (driven by
  `isFetching && !isLoading`) announces any background refetch so an on-screen value never
  changes silently. Skeletons show only on genuine first load (no cache yet).
- **When adding new client-side state, ask:** "if two people were using this on the same
  device and traded off, would one person's state leak onto the other's screen, or get
  silently reset/destroyed by the other person's actions?" If yes, it needs to go through
  one of the three mechanisms above — server data as a personId-keyed query, ephemeral UI
  state in `AppStateContext.byPerson`, or a personId-keyed `UIContext` map — not a plain
  `useState` at the top of a shared provider or component.
- Exception: toast messages, the destructive-action confirm dialog, and the PR
  celebration overlay are genuinely global, one-shot notifications tied to whatever the
  active person just did — they don't need to persist across a person switch.

## Offline Mode Notes
- **Three connectivity states, not two:** fully online; online but the backend is
  unreachable/erroring while `navigator.onLine` still reports `true` ("lie-fi" — captive-portal
  wifi, a dead upstream, flaky cellular); and offline (auto hard-offline, or a user-elected
  manual pin). Each has different UI and different write semantics — see the table below.
- **Connectivity detection layers:**
  - `useOnlineStatus` (`frontend/src/hooks/useOnlineStatus.js`) reads TanStack's `onlineManager`
    — the single source of truth every other piece of offline UI/gating reads. Reflects hard
    offline (`navigator.onLine`) or the manual pin (see below); never lie-fi.
  - **Manual pin** (`frontend/src/lib/offlineMode.js`): `pinOffline()`/`unpinOffline()` drive
    `onlineManager` directly (device-global, `localStorage` key `worktrac-offline-pinned`,
    re-applied at module load so it survives reload before the first query fires). Entered via
    the "Go offline" button on `ConnectionTroubleBanner`; only ever exited by the user (the
    `OfflineBanner`'s "Go back online" or `OfflineRecoveryPrompt`'s "Resume syncing" — both
    gated on `probeReachability()` actually succeeding first). Never auto-unpins on its own,
    even if the connection flickers back — a pin the user set on purpose stays until they lift
    it.
  - **Lie-fi detection** (`frontend/src/lib/reachabilityMonitor.js`): every request's outcome in
    `api/client.js` feeds a consecutive-failure counter; a real completed response (even a
    4xx/5xx — the server answered) resets it to zero, only a genuine network-level failure
    (rejected fetch) counts. After 3 in a row, `ConnectionTroubleBanner` suggests "Go offline".
    This is the *only* signal that can't be driven by Playwright's `context.setOffline()` — it
    needs request-level fault injection (`e2e/tests/support/faults.ts`'s `failNetwork`, not
    `failWithStatus`, which fulfills a real response and therefore never trips this).
- **The durable write outbox** (`frontend/src/lib/outboxPersistence.js` +
  `frontend/src/lib/queryClient.js`): every offline-capable write shares one TanStack mutation
  scope (`OUTBOX_SCOPE_ID`) so queued writes replay strictly serially, in enqueue order, on
  reconnect (an exercise-create replays before a set logged against its temp id, and an edit
  queued against a still-syncing set replays after the create it depends on — see the two
  Resolved Incidents below for the mechanism this guarantee depends on). Persisted to
  its own IndexedDB key (`worktrac-outbox:<accountId>`) — deliberately separate from the query
  cache's persister, so neither the query cache's 24h `maxAge` nor an app-update `buster` bump
  can ever silently drop a queued write. Every write carries a client-generated idempotency key
  so a replay (or a retried/duplicated dispatch) can't double-insert; delete-set treats a replay
  404 as success. `flushOutbox()` (resume paused + re-dispatch terminal-errored) runs on
  reconnect, on regaining tab visibility while online, after login, and from the "Go back
  online"/"Resume syncing" buttons.
  - **Retries forever on a transient failure** (`shouldRetryWrite` in `queryClient.js`): a 5xx,
    timeout, or statusless network error backs off (capped at 30s) but never gives up — a
    connectivity problem alone can never be the reason a queued write is lost or silently stops
    trying. Only a definitive 4xx (the server's real answer) stops retrying, since a write that
    can never succeed would otherwise permanently head-of-line-block every write queued behind it
    in the shared serial scope. A dependent write (log-set/note/favorite) that still resolves to
    an unmapped temp exercise id throws a status-less (therefore retryable) error instead of
    dispatching a value the backend can't parse — see the Resolved Incident below.
  - **Gated on an authenticated session:** `flushOutbox()` and `restoreOutbox()` (boot) no-op /
    hydrate everything as paused when there is no current auth token, rather than firing a queued
    write with no `Authorization` header — that tokenless request would 401, and a 401 can itself
    tear down a session that a moment later *does* have a valid token. This is what makes a
    forced-401 logout preserve the outbox safely instead of risking a login loop on the next
    sign-in.
- **Mutation coverage — active-loop (durable, offline-capable) vs. Tier-3 (online-gated):**
  | Feature | Offline? |
  |---|---|
  | Log/edit/delete a set, session start/end, session note, favorite/unfavorite, create a custom exercise | ✅ durable outbox |
  | Add person, routine CRUD, tags, default unit, rest-timer preference, exercise rename/tags/custom fields, log a past workout, export, delete account, edit person | ❌ gated — needs a connection |

  Tier-3 actions are gated because some (e.g. `createPastSession`) are **not idempotent** and
  would duplicate on replay, and others are management actions where "queue it silently" would
  be surprising. Gating is `useRequireOnline` (wraps a handler; shows a calm "needs a
  connection" toast and disables the control) or `OfflineDisabledWrap` (greys out/disables an
  entry-point button with a `title` tooltip) — both read `useOnlineStatus` only, so they do
  **not** react to lie-fi (mode 2); a Tier-3 write attempted during lie-fi is simply attempted
  and fails/succeeds for real, same as fully online.
- **Per-row UI state:** "Saving…" is reserved for a write's very first in-flight attempt.
  Once it's paused (offline), has failed and is retrying, or is sitting in a transient error, it
  gets Edit/Delete controls immediately — exactly as durable/editable as an already-synced row
  — rather than an indefinite spinner over a request that may never succeed (see
  `ExerciseDetail.jsx`'s `editableTempIds`). The banner's outbox count ("N changes waiting to
  sync") is what signals "not yet synced", not the row itself.
- **Offline cache warming** (`frontend/src/lib/offlineCacheWarm.js` /
  `useOfflineCacheWarming.js`): proactively prefetches every household member's
  logging-essentials (live session, person exercises, routines, history, PRs) in the background
  — not just whichever person/tab is on screen — so a device hand-off mid-outage (a sibling
  grabs the iPad) still renders instead of spinning forever. Deliberately still excludes
  `trendsOverview`/`exerciseTrend` (the analytics fan-out — high cost keyed by exercise × range,
  low value mid-workout) and `ExerciseDetail`'s session-scoped queries (`sessionSets`,
  `customFields`, `sessionExerciseNote` — can't be enumerated without knowing the live/edit
  session id).
  - `exerciseSummary` (Exercise Detail's "Last time"/"Best est. 1RM" card) is likewise not
    prefetched, but for a different reason: `frontend/src/utils/exerciseSummaryFromHistory.js`
    derives it client-side from the already-warmed `history` cache whenever the live query has
    no answer yet (`isPaused` — hard offline/manual pin — or `isError` — lie-fi: the fetch is
    attempted since `navigator.onLine` is true, but the backend is unreachable). Because
    `history` is unpaginated (every session, every set), this produces the *same* answer
    `StatsService#getLastSession`/`#getBest` would, not an approximation. Once stuck, the
    derived value is preferred **over** `summaryQuery.data` too, not just used when data is
    absent — `contextSessionId` collapses to the same `null` cache key both "before this person
    has ever logged anything" and "after their live session just ended," so a stale answer from
    the first of those moments can already be cached under that exact key by the time the
    second one needs it, and a stuck live query can never revalidate it away on its own.
- **A per-session display value needs its own pending-mutation fallback, not just a durable
  write — being queued in the outbox is not the same as being visible.** `contextSessionId`
  (`liveSession?.id || editingSessionId`, in `ExerciseDetail.jsx`) stays `null` for a person's
  *entire* offline/lie-fi stretch, not just before their first set: the placeholder `liveSession`
  seeded by `logSetMutation.onMutate` is deliberately `{ id: null }` so it can never leak into
  `contextSessionId`, and the real id only arrives once the create-session round trip actually
  reaches the server. Any query keyed on that id (`sessionSets`, `sessionExerciseNote`,
  `exerciseSummary`) is `enabled: !!contextSessionId` and so never even runs during that window —
  its write can be durably queued and guaranteed to sync later, while the value it produced stays
  invisible on screen the whole time. Three fallbacks in `ExerciseDetail.jsx` use the same
  technique to close this gap: `pendingBeforeSession` (an unsynced set, read from the log-set
  mutation's own variables via `useMutationState`), `derivedSummary` (the "Last time"/"Best"
  card, derived from the already-warmed `history` cache instead — see below), and
  `pendingLiveNote` (a session note saved before/without a synced session, read from the pending
  `SAVE_NOTE` mutation's own variables the same way `pendingBeforeSession` does). **When adding a
  new per-session display value, ask the same question posed for per-person state above:** would
  it stay blank for a person whose current session hasn't synced yet, even though the underlying
  write is durable and guaranteed to succeed? If yes, it needs one of these two techniques —
  derive it from an already-warmed, session-independent cache (`history`) if one exists, or read
  it straight from the relevant mutation's own variables via `useMutationState` (filtered by
  `mutationKey` plus the relevant person/exercise ids, excluding `status === 'success'` and a
  definitive-4xx failure) — rather than relying on cache invalidation alone, which is a no-op
  while paused offline.
- **Cold boot offline:** `AuthContext` boots authenticated-but-`offline:true` from a saved
  identity snapshot (`localStorage`) when `/me` fails with a network error or 5xx and a token +
  snapshot exist; a real 401 still bounces to `/login`. **No snapshot yet** (a fresh profile, or
  one just cleared) and a transient `/me` failure holds on the loading skeleton and retries with
  capped, doubling backoff (`RECONNECT_RETRY_BASE_MS`/`RECONNECT_RETRY_MAX_MS`) instead of
  signing out — the token may be perfectly valid; the server just hasn't answered yet. Requires the production service worker
  to precache the app shell (`vite-plugin-pwa`, `generateSW`, `registerType:'prompt'`) —
  **disabled in `vite dev`** (no bundle to precache there) and in Vitest. Exercise it locally via
  `npm run build && npm run preview`, or `cd e2e && npm run test:pwa`
  (`playwright.pwa.config.ts`), which builds + previews on port 3000 (needed for local CORS —
  `vite preview`'s proxy forwards the browser's real `Origin` header through, so it can't just
  run on a different port without also reconfiguring `CORS_ALLOWED_ORIGINS`) and runs only
  `offline-durability.spec.ts` (`.spec.ts` files elsewhere are `testIgnore`d from that config,
  and `offline-durability.spec.ts` itself is excluded from the fast default project).
- **Logout data-loss guard** (`frontend/src/components/layout/UserMenu.jsx`): an explicit user
  logout with a non-empty outbox shows an inline warn-and-confirm ("N changes haven't synced yet
  and will be lost") before discarding it — a different household may log in next, so the outbox
  can't just carry over. A forced 401 logout, by contrast, preserves the outbox to replay after
  re-login.

## Git Workflow
- Branch from `main`, PR back to `main`
- Conventional commits: `feat(scope):`, `fix(scope):`, `docs:`, `test:`
- All PRs require CI to pass before merge

## Development Workflow
- **All code changes are made in a git worktree, never edited directly on `main` in the
  primary working directory.** Create the worktree under `.claude/worktrees/<branch>` (the
  `EnterWorktree` tooling does this) on a new branch, iterate there, and keep the primary
  working directory on a clean `main`. Each logical change / PR gets its own worktree.
- One worktree = one branch = one logical change (one PR). Don't pile unrelated changes into
  the same worktree.
- When a change is ready to ship, use the **`/deploy-to-lower`** slash command
  (`.claude/commands/deploy-to-lower.md`). It is **user-triggered only** — never invoke it
  yourself. It documents requirements, adds/updates tests (incl. Playwright e2e), runs the
  full test suite locally, opens the PR, merges to `main`, and then monitors the automated
  lower deploy (backend + frontend + smoke + e2e) through to a green result.
- Because branch protection forbids direct pushes to `main`, every path to `main` — including
  any automated fix — goes through a PR with `backend-ci` + `frontend-ci` green. Never
  force-push or bypass branch protection.

### Concurrent Sessions
- **Assume more than one Claude Code session may be working in this repo at the same time**,
  each in its own worktree under `.claude/worktrees/`. Sessions have stepped on each other
  before (shared local dev ports, shared log files, confusion over "missing" uncommitted
  work) — check for a sibling session before taking an action that assumes you're the only
  one here:
  - Before running `/run-local` or anything else that binds ports 3000/8080: run
    `git worktree list` to see whether other worktrees exist, and check whether something is
    already listening on those ports before assuming it's safe to kill it — it may be another
    session's live dev server, not stale state.
  - Local dev log files under `/c/tmp` are shared/global, not per-worktree — treat their
    presence or a recent mtime as a signal another session may be active, not as free to
    overwrite.
  - Before concluding "my uncommitted changes are missing" or "someone deleted my work,"
    check `git reflog` and `git worktree list` — a sibling session may have already
    committed and merged what looks missing.
  - Before deleting or reusing a worktree directory, or force-pushing/rebasing a branch,
    check `.claude/worktrees/` for sibling worktrees that may still be mid-task on a related
    branch.

## Flyway Migration Rules
- NEVER edit or rename a migration file that has already been applied — create a new one
- One logical change per migration file (don't combine table creates)
- Use descriptive names: V3__add_email_verified_to_users.sql not V3__update.sql
- Seed/reference data goes in migration files too (e.g., V4__seed_roles.sql)
- Migration version numbers must be sequential — never skip or reuse a number
- Always use IF NOT EXISTS or IF EXISTS guards where T-SQL supports them

## Testing
- Backend: JUnit 5 + Spring Boot Test
- Frontend: Vitest + React Testing Library
- E2E: Playwright (run against deployed lower environment)
- Minimum: write tests for any new endpoint or user-facing feature
- `backend/src/test/resources/junit-platform.properties` is deliberately pinned to
  `parallelism=1` — this dev machine also runs `inttime-sqlserver` continuously alongside
  `worktrac-sqlserver`, and concurrent Testcontainers-backed test classes crash on
  `fs.aio-max-nr` before parallelizing gets any faster. Don't re-enable it as a perf win
  without re-checking host resource headroom.
- **Connectivity-mode e2e helpers** (`e2e/tests/support/`): `offline.ts` (banner/outbox
  locators, `goHardOffline`/`goOnline`) and `faults.ts` (`failNetwork` — a rejected fetch, the
  only thing that drives lie-fi detection — vs. `failWithStatus` — a fulfilled 4xx/5xx, which
  does not). Use these instead of ad hoc `context.setOffline`/`page.route` calls so new specs
  stay consistent with which fault type actually exercises which code path (see Offline Mode
  Notes above). Service-worker-dependent specs (cold boot, reload-while-offline) live in
  `offline-durability.spec.ts` and run only via `cd e2e && npm run test:pwa`
  (`playwright.pwa.config.ts`), never the fast default project.
- **`live-email-canary.spec.ts` is the one spec that triggers a real ACS send** — see the
  Admin Portal Notes' "Delete all e2e test data" entry above for why every other spec's
  registration is now no-op'd instead. `registerHousehold` (`auth.ts`) takes an optional
  `emailOverride` for this reason; every other call site should keep using its default-generated
  `huddle+e2e-...` address, not pass one in.
- **`bash scripts/e2e.sh` runs the suite against THIS worktree's own stack** (bringing it up
  first via `scripts/up.sh` if isolated per-worktree stacks are wired up; otherwise falls back
  to assuming the historical fixed-port stack is already running). A **global teardown**
  (`e2e/tests/support/globalTeardown.ts`, wired into `playwright.config.ts`) calls the existing
  `DELETE /api/admin/test-data` after every LOCAL run so repeated runs don't accumulate
  `huddle+e2e-...` accounts — it bootstraps (or logs into) the default admin account itself and
  is deliberately a no-op against any non-`localhost` `baseURL` (a real address on the team's
  domain, `nate+huddleadmin@starner.co` by default, would otherwise be registered/logged into
  for real against a deployed target). Never fails the run itself — any error is logged and
  swallowed, since cleanup is a hygiene nicety, not a correctness gate.

## Important Notes
- Spring profiles: `local` for development, `lower` for lower env, `production` for prod
- The `local` profile uses Docker SQL Server on localhost:1434 (see note above)
- NEVER commit passwords, tokens, or connection strings to code
- Lower and production SQL Databases are on the Basic tier (switched 2026-07-18 from
  serverless auto-pause, which added cold-start delays after idle periods — see the
  incident below). Local dev's Dockerized SQL Server was never affected by this.
- Production Container Apps run with `min-replicas=1` (always warm, no cold starts). Lower
  Container Apps still scale to 0 (cold starts possible there). Combined with the SQL tier
  note above: lower's database is always-on but its container isn't; production is
  always-on end-to-end.

## Resolved Incident: Trivy scan failure (2026-07-09)
- `docker-build`'s Trivy scan started silently failing every push despite the workflow's
  `severity: 'CRITICAL,HIGH'` filter, because a LOW-severity CVE landed in a transitive dep
  (`logback-core`) — an upstream trivy-action bug
  ([trivy-action#309](https://github.com/aquasecurity/trivy-action/issues/309)): without
  `limit-severities-for-sarif: true`, `exit-code` evaluates against the unfiltered SARIF set
  regardless of the `severity` input.
- **Takeaway:** `limit-severities-for-sarif: true` is now set on the Trivy step so a future
  LOW/MEDIUM finding can't silently fail the build the same way again. If a real HIGH/CRITICAL
  finding ever fails the build, patch/upgrade the flagged dependency rather than narrowing
  `vuln-type` — that keeps full scan coverage instead of trading it away. Full investigation
  narrative: `git log --grep=Trivy -i` (PRs #23, #24).

## Resolved Incident: silent registration failures in production (2026-07-17)
- Two registration attempts in production left zero trace anywhere (no email sent, no backend
  log output) — traced to the backend logging almost nothing on the register/confirm/resend
  path. Root-causing surfaced a real independent bug: `AuthController` read the client IP via
  `servletRequest.getRemoteAddr()` with nothing trusting `X-Forwarded-For`, so behind Azure
  Container Apps' reverse-proxy ingress the "per-IP" registration/password-reset rate limit was
  accidentally one shared bucket for every external user, not per-household.
- **Takeaway:** `server.forward-headers-strategy: framework` (`application.yml`) now trusts
  `X-Forwarded-For`; `RegistrationService` and a front-door `AuthRequestLoggingFilter` on
  `/api/auth/**` log every register/confirm/resend attempt and outcome (email only, never
  password/code), so a repeat is diagnosable instead of a dead end. Full investigation
  narrative and the Spring Security filter-ordering gotcha hit while wiring this up:
  `git log --grep="X-Forwarded-For" -i` (PR #80).

## Resolved Incident: a local DB outage force-logged the user out instead of degrading gracefully (2026-07-27)
- Reproduced locally (log in, take the database down, create an exercise, log a set against it,
  wait): the app eventually got a **401 from `live-sets`** and bounced to `/login`, even though the
  session itself was never actually invalid. Three independent, stacking causes:
  1. An unhandled exception on an authenticated route (a malformed request body, a
     `DataAccessException`) escaped `GlobalExceptionHandler` and hit the servlet container's
     `/error` re-dispatch, which re-runs the stateless security chain as **anonymous** and turns
     even a benign failure into a 401 — the exact mechanism already documented on
     `SecurityConfig`'s `exceptionHandling` block, but nothing upstream of it actually prevented an
     exception from reaching that path. Concretely reachable because an exercise-create that
     couldn't reach the DB used to give up after a bounded number of retries without ever
     recording its temp→real id mapping, so a queued log-set replayed with the raw
     `"temp-exercise-<uuid>"` placeholder string, which the backend's `Long`-typed field couldn't
     parse.
  2. `flushOutbox()`/`restoreOutbox()` replayed queued writes with no check for a live session, so
     a write dispatched with a stale/cleared token 401'd and could tear a *freshly re-established*
     session back down — a handful of stuck queued writes turned re-login into a bounce loop.
  3. A cold boot whose `/me` call failed with no saved identity snapshot yet available signed the
     user out immediately, even though the failure was a transient outage, not an invalid token.
- **Takeaway:** `GlobalExceptionHandler` now answers every failure mode (malformed request, DB
  outage, anything else unhandled) with an honest 400/503/500 instead of letting it escape to
  `/error`. Durable writes retry transient failures forever instead of giving up (see Offline Mode
  Notes), and a dependent write refuses to dispatch with an unresolved temp id. `flushOutbox`/
  `restoreOutbox` gate on an authenticated token, and `/me`'s boot retry backs off instead of
  signing out on a transient failure. The general lesson: a DB/backend outage must always degrade
  to "queue and retry," never to "the session is invalid" — those are different failure classes and
  conflating them is what turns an infrastructure blip into a data-loss-flavored user-facing bug.
  Full investigation narrative: `git log --grep="never logs the user out\|login loop" -i`.

## Resolved Incident: cached sections went blank during a prolonged lie-fi session (2026-07-28)
- During lie-fi (backend unreachable, `navigator.onLine` still true), cached sections
  (History, session/exercise data) rendered correctly at first but went blank after
  extended use, even though nothing was ever lost server-side. Two independent, reasonable
  behaviors combined: `swUpdate.js`'s `tryForceUpdate` silently reloads the page on ordinary
  navigation (person/section/exercise switch) whenever a new service-worker build is
  available -- invisible to the user since `AppStateContext` seamlessly restores the same
  screen/position. Meanwhile `queryClient.js`'s `persistOptions` had no
  `shouldDehydrateQuery` override, so TanStack's default (`status === 'success'`) dropped a
  query from the next persisted IndexedDB snapshot the instant any background refetch
  failed -- even though `data` itself stayed intact in memory. Ordinary lie-fi background
  refetches (window-focus, the offline-cache-warm cycle) kept flipping more queries into
  that state over time. If a silent reload landed while a query was in it, `hydrate()` had
  nothing on disk to restore, so the section booted data-less and the immediate real fetch
  failed too (backend still down).
- **Takeaway:** `shouldDehydrateQuery` (`queryClient.js`) now persists a query whenever it
  holds usable `data`, regardless of its last fetch attempt's status -- reproduced and
  verified via a `dehydrate`/`hydrate` round-trip test against the app's real
  `persistOptions` (see `queryClient.test.js`) before and after the fix, confirming both the
  bug and the fix mechanically rather than by inspection alone.

## Resolved Incident: the offline banner's "Go back online" button never worked, only the Settings toggle did (2026-07-28)
- `OfflineBanner`'s "Go back online" click handler only unpins offline mode if
  `probeReachability()` (a `fetch` to `/actuator/health`) succeeds, but `CorsConfig.java`
  only registered CORS for `/api/**` — `/actuator/health` never got
  `Access-Control-Allow-Origin`, so that cross-origin fetch always failed as a network error
  in every deployed environment (frontend and backend on different origins), even though the
  endpoint itself is `permitAll()` and answers fine. Settings' "Offline Mode" toggle calls the
  exact same `unpinOffline()`/`pinOffline()` functions on the exact same pin flag, but
  unconditionally, with no probe — so it always worked, making the banner button look broken
  by comparison even though there is only one offline-pin flag, not two. Local dev/preview
  never reproduced this because Vite's proxy forwards `/actuator` same-origin.
- **Takeaway:** `CorsConfig.java` now also registers `/actuator/health`. Any future
  cross-origin frontend call to a non-`/api/**` backend path (another actuator endpoint, etc.)
  needs its own registration here too — CORS is per-path, not per-security-rule; `permitAll()`
  in `SecurityConfig` only controls auth, not CORS headers.

## Resolved Incident: the durable outbox could replay out of enqueue order under lie-fi + a reload, deadlocking every queued write (2026-07-29)
- Reproduced in lower: create a custom exercise, log sets against it, with lie-fi and a page
  reload or two mixed in. On reconnect, **nothing synced** — a log-set had replayed before the
  exercise-create it depended on, so its `exerciseId` was still an unresolved temp id.
- Root cause: TanStack's shared mutation scope (`OUTBOX_SCOPE_ID`) really does serialize writes
  one at a time, but the order it enforces is **registration order into the scope's internal
  array**, not `submittedAt`. `restoreOutbox` used to split restored writes into two batches —
  hydrate every *paused* write, THEN dispatch every *not-paused* write — instead of one pass
  merged by true submit time. Under lie-fi, `navigator.onLine` stays `true`, so an
  actively-retrying write (e.g. the exercise-create) is never marked paused; if a *later*
  write (e.g. the dependent log-set) happened to be genuinely paused at persist time, a reload
  would register it into the scope ahead of the earlier create. And because a mutation whose
  `mutationFn` keeps throwing (`shouldRetryWrite` retries forever on anything but a definitive
  4xx) never leaves `state.status = 'pending'`, it never releases its scope slot — permanently
  blocking every *other* queued write behind it too, not just the misordered one.
  `flushOutbox`'s stuck-mutation retry had the identical defect (remove-then-recreate always
  re-registers at the end of the scope's array, regardless of true submit order).
- **Takeaway:** `restoreOutbox` now merges paused and not-paused writes into one
  `submittedAt`-sorted pass before registering anything, so registration order always matches
  true enqueue order. `flushOutbox`'s stuck-retry now restarts the same `Mutation` object in
  place (`m.execute(...)`) instead of removing and recreating it — safe there specifically
  because a terminal-`'error'` mutation's retryer has already fully settled, unlike a `'pending'`
  one, which could still have a live retry loop that a second `execute()` call would race rather
  than cancel. **The "editing a still-queued offline set" follow-up flagged here is now
  resolved** — see the next Resolved Incident entry below (2026-07-30): rather than finding a
  way to reorder/reuse the queued create's mutation, editing a pending set no longer touches the
  create at all. Full investigation narrative for this entry: `git log --grep="outbox" -i
  --grep="replay order" -i`.

## Resolved Incident: editing a still-queued offline set could reorder it, or silently lose the edit (2026-07-30)
- Follow-up to the entry above. Two related problems in `offlineSetEdits.js`'s
  `replacePendingLogSet` (used whenever `EditSetModal` saves a change to a set that hasn't synced
  yet): (1) it removed the pending `logSet` create and re-dispatched a fresh one, which — like the
  bug above — always re-registers at the *end* of the shared outbox scope's array, so it could
  still jump ahead of/behind other queued writes within the same session (only a *subsequent
  reload* self-corrected it, via the already-fixed `restoreOutbox`). (2) More seriously: the
  re-dispatched create kept the SAME `idempotencyKey` as the original. If that original create had
  already reached the server under lie-fi (response lost, or a retry landed after a dropped first
  attempt), the re-dispatch collided with `WorkoutSetService.findDuplicate`
  (`backend/.../workoutset/WorkoutSetService.java`), which keys **only** on `idempotencyKey` and
  returns the already-committed row **ignoring the new payload** — so the edited weight/reps were
  silently discarded, with no error surfaced anywhere.
- Investigation also confirmed a hard constraint against the "obvious" alternative fix (edit the
  queued create in place): traced against the exact pinned `@tanstack/react-query@5.101.2` source,
  there is **no public API to cancel an in-flight mutation's retry loop**, and calling
  `Mutation.execute(newVars)` on an already-`'pending'` mutation takes an internal `restored`
  branch that skips the `state.variables` update entirely — so even if cancellation weren't a
  problem, the UI wouldn't show the edited values. In-place editing was never viable.
- **Takeaway:** editing a pending set no longer touches its queued create at all. It's now a
  genuinely separate, durable `EDIT_SET` write targeting the create's `tempId`, resolved to the
  real set id via a new `frontend/src/lib/setIdMap.js` — structurally identical to
  `exerciseIdMap.js`'s existing temp-exercise-id resolution, just applied to a second entity.
  `LOG_SET`'s `onSettled` records the tempId→realId mapping on success (mirroring
  `CREATE_EXERCISE`'s); `EDIT_SET`'s `mutationFn` resolves through it via `requireResolvedSetId`,
  throwing the same status-less/retryable shape as `requireResolvedExerciseId` when the create
  hasn't synced yet, so the shared serial scope guarantees the create replays first. This makes
  editing a pending set behave identically to editing an already-synced one in every connectivity
  mode (online / hard-offline / lie-fi) — same code path, differing only in whether the target id
  starts temp or real — and fixes both problems above: the create is never removed or reordered,
  and there is no same-key re-dispatch for `findDuplicate` to collide with.
- **Accepted UX costs, deliberately not engineered away (documented here, not just in code, so a
  future change doesn't "fix" them into new special-casing):**
  - **A brief revert-then-correct flicker is possible on reconnect**, but *only* for a set edited
    before it ever synced. The create still commits its **original** value first (by design — see
    above), then the separate `EDIT_SET` applies the correction; each write's `onSettled`
    invalidates the relevant queries, so a refetch between the two could briefly repaint the
    original value before the corrected one lands. An already-synced set has no queued create in
    play, so this never happens for the common (online) case. Rejected fix: special-casing the
    hard-offline path to fold the correction into the create's own outgoing payload (avoiding the
    second write entirely) — this would require branching by connectivity mode at write time,
    reintroducing exactly the kind of mode-specific special-casing this whole redesign exists to
    get away from, for a cosmetic, self-correcting flicker.
  - **PR celebration can reflect the pre-edit value.** Because the create is never touched, a set
    that was a PR *as originally logged* can still trigger "New PR!" on sync even if it was edited
    down before reconnecting. This is a deliberate consequence of leaving the create alone, not an
    oversight — suppressing it would mean tracking "was this pending set edited" as extra state and
    threading it into PR detection, again the kind of special-casing being avoided. Narrow in
    practice (requires editing a PR-setting set before it ever syncs) and arguably more honest than
    the alternative (a PR you actually hit not being celebrated because you fixed a typo in it
    later).
  - Both costs are confined to "a set edited before it ever synced" — never afflict editing an
    already-synced set — and were an explicit, discussed trade favoring one uniform code path over
    chasing every polish case. See `git log --grep="editing a still-queued" -i` for the full
    design discussion.

## Resolved Incident: a stale boot `/me` response could silently clobber a fresh login's `freshLogin` flag (2026-07-31)
- Caught by a new e2e regression test (`multi-person.spec.ts`) that failed only in the deployed
  lower environment, never locally — a page reload, then an almost-immediate logout + log back in
  as the same household, landed the just-added person on their *old* last-open tab instead of Log.
  A Playwright trace of the lower failure showed the reload's boot `/api/auth/me` call still
  in-flight when the login flow's own requests fired ~200ms later — a timing window real network
  latency (cross-origin, Azure round trips) opens up but a same-origin localhost dev/preview server
  essentially never does, which is why it never reproduced locally until the race was forced
  deterministically with a gated `page.route()` interception.
- Root cause: `AuthContext`'s boot effect (`attemptMe`, mounted with `useEffect(..., [])`) is never
  cancelled by a subsequent `logout()`/`login()` — only by the whole provider unmounting, which
  never happens within one SPA session. If that stale `/me` resolves *while genuinely signed out*
  (between `logout()`'s `setState(SIGNED_OUT)` and the real `login()` call's own final `setState`),
  its unconditional `setState({ status: 'authenticated', offline: false, ...data })` flips `status`
  back to `'authenticated'` **on its own**, with no `freshLogin` flag (that only gets set by
  `login()`/`confirmEmail()` themselves, which haven't run yet). `AppStateContext`'s hydrate effect
  reacts to this premature transition and applies `resetTab: undefined`. When the real `login()`
  call finishes moments later and sets `status` to the *same* `'authenticated'` value, React's
  effect-dependency check sees no change and the hydrate effect never re-fires — the correct
  `resetTab: true` is never applied, silently for every person except whichever one was already
  active (they land on Log anyway, via `LoginPage`'s own unconditional `navigate('/app/log')`,
  masking the bug for exactly the one case an e2e test would naively check first).
- **Takeaway:** both `AuthContext.jsx` effects that call `apiMe()` in the background (the boot
  effect and the online-reconnect reconciler) now discard their response if the current auth token
  no longer matches the token that was active when the call was made — a general "is this response
  still relevant" guard, not a `freshLogin`-specific patch, since the same staleness class could in
  principle clobber any other field a future background reconciliation writes. The regression test
  holds the boot `/me` open via a manually-released `page.route()` gate (not a fixed delay, which
  proved too timing-sensitive to reliably land the response in the exact window that matters) and
  releases it deterministically while signed out. Full investigation narrative:
  `git log --grep="stale.*me\|freshLogin" -i`.

## Resolved Incident: the durable outbox could still reorder (and, on a second reload, re-deadlock) under lie-fi, despite the 2026-07-29 fix (2026-08-01)
- User report: queued writes in the "N changes waiting to sync" list still visibly changed order
  under lie-fi, "particularly painful when there are dependencies" — even after the 2026-07-29 fix
  above. Investigation confirmed that fix did *not* regress: the live serial outbox scope (no
  reload involved) genuinely replays in registration order, proven by
  `intermittent-errors.spec.ts`'s continuous-lie-fi create+set test. The defect was narrower and
  specifically about *reconstructing* order across a reload.
- Root cause: `restoreOutbox`'s registration-order fix keyed everything off TanStack's own
  `state.submittedAt` — but that's a framework timestamp, **re-stamped to "now" every time a
  mutation is re-executed**. `restoreOutbox`'s re-dispatch of a not-paused (lie-fi) write did not
  preserve its original `submittedAt` (only `flushOutbox`'s stuck-retry path did that, via an
  explicit capture/restore). One reload was enough to make that write's `submittedAt` **display**
  out of order in `useOutboxItems` (which also sorted by `submittedAt`) even though the underlying
  scope replay was still correct that one time. A **second** reload was worse: the drifted
  `submittedAt` from reload #1 would now sort *actually wrong* on reload #2's registration pass,
  reintroducing the exact 2026-07-29 deadlock (a dependent write registered ahead of the create it
  depends on, permanently blocked on `requireResolvedExerciseId`'s retryable-forever error).
  Ordinary lie-fi use supplies "a reload or two" without the user ever manually reloading, via
  `swUpdate.js`'s silent forced reload on an ordinary person/section switch.
- **Takeaway:** replaced the mutable `submittedAt` ordering key with an immutable, monotonic,
  app-assigned `enqueueSeq` (`frontend/src/lib/outboxSequence.js`), stamped once into a durable
  write's own `variables` at first dispatch (`dispatchDurableWrite` / the `useDurableMutation` hook
  wrapping every component-level durable `useMutation`) and never touched again — the same
  principle `clientLoggedAt` already applies to rest-time math (see Data Model Notes above) and
  `pendingBeforeSession` already applies to sorting still-unsynced sets. `restoreOutbox`,
  `flushOutbox`, and `useOutboxItems` all sort by this key now (`byEnqueueOrder`), which **deletes**
  the fragile "capture and restore `submittedAt` around every re-execute" pattern entirely — there
  is nothing left to preserve, so the class of bug where a future call site forgets to preserve it
  is structurally impossible. Also fixed the one other place still keying off mutable `submittedAt`
  for a "pick the newest" comparison: `ExerciseDetail.jsx`'s `pendingLiveNote`. **Rule for any future
  ordering/"pick latest" logic over queued mutations: key off an immutable, app-assigned value
  (`clientLoggedAt`, `enqueueSeq`), never TanStack's own `submittedAt`.**
- Also closes a latent rest-time (`rest_seconds`) correctness gap noted during investigation, not
  just the reported display/deadlock symptom: `WorkoutSetService.computeRestSeconds` computes rest
  once at insert time against whichever set is currently the most recent in the DB, so replaying two
  live sets of one exercise out of order (the same submittedAt-drift bug, no create dependency
  needed) could silently produce a `null` rest for the true second set and a negative one for the
  true first. Guaranteeing in-order replay across any number of reloads fixes this as a side effect.
- New regression coverage added specifically for the reload-reconstruction path (not just the live
  scope, which 2026-07-29's tests already covered): a double-reload-under-lie-fi test and a
  connectivity-*transition* test (offline → lie-fi drift, not just two static starting cohorts) in
  `outboxPersistence.test.js`, a scrambled-persisted-array-order test proving the sort actually
  re-orders (not just preserves already-ordered input), and a `useOutboxItems` test proving the
  *displayed* list order survives a reload. Full investigation narrative:
  `git log --grep="enqueueSeq\|outbox.*reorder" -i`.

## Resolved Incident: a registration's verification email vanished with zero trace, and the test-data-cleanup delete timed out (2026-08-01)
- User testing in lower hit two issues in one session: (1) clicking "Delete all e2e test data"
  timed out client-side with the data never actually deleted, and (2) registering
  `nate+2@starner.co` showed `REGISTER_STARTED` in the Activity tab with **no** corresponding
  `VERIFICATION_EMAIL_SENT`/`FAILED` event ever appearing, and no OTP email arrived — "It seems
  to have gone into a blackhole."
- Root cause of (1): `TestDataCleanupService.deleteAll()` (added in PR #113) looped
  `AccountDeletionService.deleteAccount(Long)` once per matching e2e account. Spring Data JPA's
  derived `deleteByAccount_Id`/`deleteByEmailLike` methods that cascade calls (used there)
  select every matching entity and remove it one at a time rather than issuing a single `DELETE`
  statement — fine for one account, but lower had accumulated hundreds across repeated deploys'
  e2e runs, and the resulting total round trips exceeded the frontend's 15s request timeout.
- Root cause of (2), and how it connects to (1): the client timing out does **not** cancel the
  backend's still-running transaction — that long-running, DB-heavy delete is suspected to have
  contributed to `AsyncConfig`'s `emailTaskExecutor` (a small bounded `ThreadPoolTaskExecutor`)
  hitting its queue capacity at the same moment a real registration's verification-email
  dispatch was submitted. The executor's default `RejectedExecutionHandler` is `AbortPolicy`,
  which throws a `TaskRejectedException` with nowhere for an `@Async void` method to route it —
  the task simply never ran, and because `RegistrationEmailEventListener`'s SENT/FAILED
  audit-recording code lives *inside* that task body, nothing was ever written to
  `registration_events` for it. `REGISTER_STARTED` alone had already committed synchronously
  inside `register()`'s own request thread, which is why that one event *did* show up.
- Investigating this surfaced a second, independent, previously-latent bug while reviewing the
  same listener: if a send genuinely *succeeded* but the subsequent `VERIFICATION_EMAIL_SENT`
  audit-write itself then threw (a transient DB hiccup at that exact moment), the single
  try/catch wrapping both calls would catch that exception and record `VERIFICATION_EMAIL_FAILED`
  instead — silently misreporting a successfully-delivered email as failed, which would also have
  falsely triggered an admin "send failure" alert for an email that actually went out fine.
- **Takeaway, per an explicit, broader user mandate ("every part of the registration process
  needs appropriate logging/visibility/alerting — no blind spots where it's unknown what
  happened"):** rather than patching just the one reported scenario, the whole pipeline was
  audited end to end and hardened at every layer described in the Admin Portal Notes entries
  above — `AsyncConfig`'s `CallerRunsPolicy` (a saturated queue can never again drop a task
  silently), `RegistrationEmailEventListener`'s send/audit-write separation (a failure to persist
  can never be misreported as a send failure), `RegistrationDispatchWatchdog`'s periodic
  reconciliation (a safety net for failure modes nobody has specifically anticipated, not just
  the ones with their own `catch` block), `ADMIN_ALERT_FAILED` visibility (an alert that itself
  fails to send is no longer only a log line), identical audit coverage extended to the
  previously-uninstrumented password-reset email flow, and `TestDataCleanupService`'s genuine
  bulk-delete rewrite (plus a longer, dedicated frontend timeout as a second line of defense).
  The general lesson, consistent with the durable-outbox principle already established for
  offline writes: an async dispatch mechanism must never have a code path where "the task didn't
  run" and "the task ran and nothing went wrong" are indistinguishable from the outside. Full
  investigation narrative: `git log --grep="blind spot\|CallerRunsPolicy\|DISPATCH_MISSING" -i`.
