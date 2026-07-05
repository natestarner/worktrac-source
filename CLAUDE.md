# Workout Tracker

## Project Overview
React frontend + Java Spring Boot microservices backend, deployed to Azure via GitHub Actions.
Tracks workouts (exercises, sets, reps) for multiple people (Nate and his sons) from one
household, with each person's data kept separate. Optimized for iPad and iPhone use during
workouts.

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
- The schema for people/workouts/exercises/sets has not been designed yet (pipeline setup
  came first, by design). Design it carefully before writing the first Flyway migration.

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
