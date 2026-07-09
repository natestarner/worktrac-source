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
