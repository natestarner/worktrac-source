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
  log-set + retry safe.
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
  reconnect (an exercise-create replays before a set logged against its temp id). Persisted to
  its own IndexedDB key (`worktrac-outbox:<accountId>`) — deliberately separate from the query
  cache's persister, so neither the query cache's 24h `maxAge` nor an app-update `buster` bump
  can ever silently drop a queued write. Every write carries a client-generated idempotency key
  so a replay (or a retried/duplicated dispatch) can't double-insert; delete-set treats a replay
  404 as success. `flushOutbox()` (resume paused + re-dispatch terminal-errored) runs on
  reconnect, on regaining tab visibility while online, after login, and from the "Go back
  online"/"Resume syncing" buttons.
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
  logging-essentials (live session, person exercises, routines, history) in the background —
  not just whichever person/tab is on screen — so a device hand-off mid-outage (a sibling grabs
  the iPad) still renders instead of spinning forever. Deliberately excludes analytics
  (PRs/trends) and `ExerciseDetail`'s interaction-scoped queries.
- **Cold boot offline:** `AuthContext` boots authenticated-but-`offline:true` from a saved
  identity snapshot (`localStorage`) when `/me` fails with a network error or 5xx and a token +
  snapshot exist; a real 401 still bounces to `/login`. Requires the production service worker
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
