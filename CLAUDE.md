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
- Database free tier auto-pauses — expect cold start delays

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
