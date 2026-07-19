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
  - Otherwise, computed once at insert time as the gap between now and the most recent
    prior set's `created_at` for the *same session + same exercise* — scoped by exercise,
    not just session, so supersetting into a different exercise between sets doesn't
    corrupt the number.
  - **Immutable after insert**, by construction: `WorkoutSet.restSeconds` has no setter.
    Editing a set's weight/reps (`editSet`) must never touch it, and deleting or editing
    a neighboring set does not retroactively recompute it — it's a snapshot of what
    actually happened at the time, not a live-derived value.
  - Computed from the app's injected `Clock` bean (`ClockConfig`), not `Instant.now()`,
    so it's deterministically testable with `MutableClock` (see `RestSecondsTest.java`),
    matching the same pattern `WorkoutSessionService` uses for its 8-hour staleness rule.
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
  `CurrentUser.accountId()`. Admin DTOs must never include `password_hash` or
  `pending_registrations.code_hash` — curate every field added to them.
- **Read-only in this phase** — no admin action mutates app data. Login-attempt/email-sent
  audit logging (a natural next step) is deliberately deferred, not part of this feature.
- Frontend: `AdminRoute` redirects a non-admin (even if authenticated) to `/app/log` rather
  than showing an access-denied screen, so the portal's existence isn't revealed to ordinary
  users. It's a standalone layout (`AdminShell`) under `/admin`, not a tab inside the
  workout app's `AppShell`/`TabsNav`.

## Frontend State Notes
- **Every person has their own independent client-side state.** Whatever a person is
  currently doing or viewing — which tab/screen, selected exercise, routine position,
  draft weight/reps, exercise search text, an in-progress past-session edit, an active
  rest timer, etc. — must survive switching to another person and back. Nothing that
  represents "what this person is doing right now" should live as a single global value.
- This is the client-side mirror of the Data Model Notes above: the backend keeps each
  person's *data* separate; the frontend must keep each person's *in-progress UI state*
  separate too. Same principle, different layer.
- Implemented via two mechanisms:
  - `AppStateContext` (`frontend/src/context/AppStateContext.jsx`) — a per-person
    snapshot cache (`personSnapshots`), captured/restored on every person switch. Covers
    navigation/draft state: current tab, selected exercise, routine position,
    weight/reps drafts, exercise search, in-progress past-session edit.
  - `UIContext` (`frontend/src/context/UIContext.jsx`) — state keyed by personId directly
    (e.g. `restTimers: { [personId]: {...} }`), used when a person's state needs to keep
    running independently in the background even while a *different* person is active
    (e.g. one person's rest timer must keep counting down while someone else takes their
    turn logging a set).
- **When adding new client-side state, ask:** "if two people were using this on the same
  device and traded off, would one person's state leak onto the other's screen, or get
  silently reset/destroyed by the other person's actions?" If yes, it needs to go through
  one of the two mechanisms above — not a plain `useState` at the top of a shared
  provider or component.
- Exception: toast messages, the destructive-action confirm dialog, and the PR
  celebration overlay are genuinely global, one-shot notifications tied to whatever the
  active person just did — they don't need to persist across a person switch.

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
- `docker-build`'s vulnerability scan started failing (silent exit code 1, no console
  output) on every push to `main` starting 2026-07-09, blocking `promote-to-lower`.
- Root cause, confirmed via a controlled revert-and-retest and by inspecting the actual
  SARIF result counts via the GitHub code-scanning API (not just the console log, which
  prints nothing useful for `format: sarif`): Trivy's Java vulnerability database picked
  up a new entry, `CVE-2026-10532` (`ch.qos.logback:logback-core` 1.5.34, severity LOW).
  trivy-action failed the build on it despite the workflow's `severity: 'CRITICAL,HIGH'`
  filter — a documented upstream bug
  ([trivy-action#309](https://github.com/aquasecurity/trivy-action/issues/309)):
  without `limit-severities-for-sarif: true`, the SARIF report is built with ALL
  severities regardless of the `severity` input, and `exit-code` evaluates against that
  unfiltered set. Not caused by app code or by a stale Trivy version — reproduced
  identically against the prior day's exact passing dependency tree and on two different
  Trivy binary versions.
- Fix: bumped `logback.version` to `1.5.35` in `backend/pom.xml` (overriding Spring
  Boot's managed version) to patch the actual CVE, which resolved the underlying finding
  and let the scan pass cleanly again with full `os,library` coverage restored. Also
  added `limit-severities-for-sarif: true` to the Trivy step so a future LOW/MEDIUM
  finding on some other dependency can't silently fail the build the same way again —
  if a real HIGH/CRITICAL finding ever fails the build, patching/upgrading the flagged
  dependency (rather than narrowing `vuln-type`) is the preferred fix, since it keeps
  full scan coverage instead of trading it away.

## Resolved Incident: silent registration failures in production (2026-07-17)
- Two people's registration attempts in production left zero trace anywhere: no
  verification-code email sent (confirmed absent in Azure Communication Services), and no
  error anywhere in the backend container logs.
- Investigation ruled out, in order: an ACS send failure (a manual re-test sent
  successfully, proving ACS credentials/connectivity were fine); container cold start
  (min-replicas for `worktrac-backend-prod` had already been bumped to 1 days earlier);
  and a production deploy landing mid-attempt (confirmed the deploy that evening had
  already finished before the two people tried). SQL Database auto-pause was live at the
  time and couldn't be ruled out, which is why lower/production were switched to Basic
  tier (see the note above) during this investigation, before root cause was fully
  confirmed.
- The investigation kept hitting a dead end for a structural reason, not a data-availability
  one: the backend produced **zero log output** for a registration attempt on almost every
  path (success, rate-limit rejection, and most ordinary failures were all silent), so
  there was nothing to inspect even with full Log Analytics access.
- Separately, code reading surfaced a real, independent bug: `AuthController` read the
  client IP via `servletRequest.getRemoteAddr()` with nothing trusting `X-Forwarded-For`.
  Since Azure Container Apps' ingress is the sole external entry point and is a reverse
  proxy, `getRemoteAddr()` always returned the ingress's own hop address — meaning the
  "per-IP" registration/password-reset rate limit was accidentally a single bucket shared
  by every external user of the whole app, not a per-household limit.
- Fix (backend, `fix(auth): trust X-Forwarded-For and add auth request logging`):
  `server.forward-headers-strategy: framework` in `application.yml` fixes the IP-bucketing
  bug for all four affected endpoints at once. `RegistrationService` now logs the outcome
  of every register/confirm/resend attempt (including which rate-limit bucket rejected a
  request). A new front-door `AuthRequestLoggingFilter` on `/api/auth/**` logs
  method/path/ip/email/status/duration for every request regardless of how deep it got,
  closing the gap for requests that die before reaching any service (CORS rejection,
  `@Valid` binding failures, an unhandled exception). The filter extracts only the `email`
  field from the request body (never password or verification code).
- A real bug surfaced while wiring up the new filter: registering it via
  `.addFilterBefore(newFilter, JwtAuthenticationFilter.class)` *before*
  `JwtAuthenticationFilter` itself had been given a registered order (via its own
  `addFilterBefore` call relative to the standard `UsernamePasswordAuthenticationFilter`)
  broke Spring Security startup entirely ("The Filter class ... does not have a registered
  order"). `addFilterBefore` resolves each filter's position imperatively as the builder
  chain executes — order the calls so any filter referenced as a `beforeFilter` argument
  has already been given a position by an earlier call.
- Also surfaced (unrelated to the fix itself, but found while verifying it): backend JUnit
  tests run 4 test classes concurrently by default, each spinning up its own Testcontainers
  SQL Server instance. On a dev machine that also keeps `worktrac-sqlserver` and
  `inttime-sqlserver` running continuously, adding one more SQL-backed test class pushed a
  4-way run over the host's available async-I/O resources and crashed every container
  outright (`fs.aio-max-nr`). Empirically, 2-way parallelism didn't crash but was *slower*
  than 1-way (containers thrash instead of parallelizing once host resources are this
  contended) — `backend/src/test/resources/junit-platform.properties` is now pinned to
  `parallelism=1` on this basis, with the measurements in its comment.
