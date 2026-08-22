# Workout Tracker

## Project Overview
React frontend + Java Spring Boot microservices backend, deployed to Azure via GitHub Actions.
Tracks workouts (exercises, sets, reps) for multiple people (Nate and his sons) from one
household, with **each person's data kept fully separate**. Optimized for iPad and iPhone use
during workouts.

## Tech Stack
- Frontend: React (JavaScript), Vite, TanStack Query — served by Azure Static Web Apps
- Backend: Java 25, Spring Boot 4.x, Maven
- Database: Azure SQL (SQL Server); local dev uses SQL Server in Docker
- CI/CD: GitHub Actions, GitHub Container Registry (GHCR)
- Hosting: Azure Container Apps (backend), Azure Static Web Apps (frontend)

## Key Directories
- `frontend/` — React application (the app, at `app.huddle.fitness`)
- `marketing/` — static landing page at `huddle.fitness`; no build step, its own SWA
  (`docs/marketing-site.md`)
- `backend/` — Spring Boot application
- `backend/src/main/resources/db/migration/` — Flyway SQL migrations
- `e2e/` — Playwright end-to-end tests
- `.github/workflows/` — CI/CD pipelines

## Common Commands
```bash
# Local development — starts THIS worktree's own isolated stack (own ports, own database on
# the shared SQL Server container).
bash scripts/up.sh      # or the /run-local skill
bash scripts/down.sh    # or the /stop-local skill

cd e2e && bash ../scripts/e2e.sh   # e2e against THIS worktree's own running stack

bash scripts/test-backend.sh unit  # fast: non-container unit tests only
bash scripts/test-backend.sh       # everything (or: cd backend && mvn verify)
cd frontend && npm test            # frontend tests
```

## Code Standards
- Java: 4-space indentation, Spring Boot conventions. JavaScript/React: 2-space, ESLint + Prettier.
- **SQL is T-SQL, not MySQL/Postgres** — applies to migrations and native queries alike:
  - `IDENTITY(1,1)` not `AUTO_INCREMENT`
  - `NVARCHAR` not `VARCHAR`
  - `BIT` not `BOOLEAN`
  - `GETDATE()` not `NOW()`
  - `DATETIME2` not `TIMESTAMP`
  - `TOP(n)` not `LIMIT n`
  - `ISNULL()` not `IFNULL()` (though `COALESCE()` works in T-SQL too)
- CORS is configured globally in `CorsConfig.java` — do not add `@CrossOrigin` to individual
  controllers. Allowed origins come from the `CORS_ALLOWED_ORIGINS` environment variable, not
  hardcoded values.
- Database schema changes go in Flyway migration files, never manual DDL.
- Never set `spring.jpa.hibernate.ddl-auto` to anything other than `validate`.
- Every query must filter by the active person — see "Deeper context" below.

## The app must work the same in every condition

Online, lie-fi, hard offline, user-pinned offline, backend cold-starting, DB down, pool exhausted,
mid-deploy reload, restored-from-stale-state. **Degradation is the default case, not an edge
case.** This applies to every approach, fix, and new feature — not just ones that look
"offline-related".

- **One code path for all conditions.** Branching on connectivity is the exception: it needs an
  inline comment saying why *and* an entry in the register in `.claude/rules/resilience.md`.
  A branch that isn't on that register is a bug until it's added with a reason — and nothing on
  the register may be "simplified" away.
- **Reuse the existing mechanism; don't invent a second one.** Durable write →
  `useDurableMutation`. Online-only write → `useGatedMutation`. "Am I online?" → `useOnlineStatus`.
  Ordering → `enqueueSeq`. The full table is in the rule file. A second way to do an existing job
  is the bug.
- **Failure degrades to *queue and retry* or *show what's cached*** — never to signed-out, blank,
  silently-lost, or a spinner over a request that will never succeed.
- **Prove it, don't argue it.** User-visible flows get a parity test
  (`e2e/tests/support/parity.ts`) that runs one assertion body across modes. Claiming a flow
  "behaves identically in every connectivity mode" in a comment is what we did before; it was
  wrong twice.

Checklist + register: `.claude/rules/resilience.md` (auto-loads). Reasoning:
`docs/architecture/resilience.md`. Enforced by `scripts/check-resilience-invariants.sh`.

## Flyway Migration Rules
- **NEVER edit or rename a migration that has already been applied** — create a new one.
- One logical change per migration file. Version numbers must be sequential — never skip or reuse.
- Descriptive names: `V3__add_email_verified_to_users.sql`, not `V3__update.sql`.
- Seed/reference data goes in migration files too (e.g. `V4__seed_roles.sql`).
- Use `IF NOT EXISTS` / `IF EXISTS` guards where T-SQL supports them.

## Git & Development Workflow
- Branch from `main`, PR back to `main`. Conventional commits: `feat(scope):`, `fix(scope):`,
  `docs:`, `test:`. All PRs require CI to pass before merge.
- **All code changes are made in a git worktree, never edited directly on `main` in the primary
  working directory.** Create it under `.claude/worktrees/<branch>` (the `EnterWorktree` tooling
  does this) on a new branch; keep the primary working directory on a clean `main`.
- One worktree = one branch = one logical change = one PR. Don't pile unrelated changes together.
- When a change is ready to ship, use the **`/deploy-to-lower`** slash command
  (`.claude/commands/deploy-to-lower.md`). It is **user-triggered only — never invoke it
  yourself.**
- Branch protection forbids direct pushes to `main`, so every path to `main` goes through a PR
  with `backend-ci` + `frontend-ci` green. Never force-push or bypass branch protection.
- Minimum test bar: any new endpoint or user-facing feature needs coverage, including Playwright
  e2e.

### Concurrent sessions
**Assume more than one Claude Code session may be working in this repo at the same time**, each
in its own worktree under `.claude/worktrees/`. `/run-local` and `/stop-local` derive per-worktree
ports and databases automatically, and dev logs live in each worktree's own `.dev-logs/`, so
ordinary local dev across parallel worktrees doesn't collide. Still check first before anything
not worktree-scoped:
- **Retiring finished worktrees: use `bash scripts/worktree-cleanup.sh`** (dry run by default;
  `--force` to act). Don't hand-roll it — both halves of the obvious approach are wrong here, and
  each one has already cost a round trip:
  - **"Is it merged?" cannot be answered by ancestry.** PRs are squash-merged, so a merged
    branch's commits are never ancestors of `main` — `git log main..branch`, `git branch -d` and
    `git merge-base --is-ancestor` all report a fully-merged branch as unmerged. The authority is
    `gh pr view <n> --json headRefOid`: if the merged PR's head equals the branch tip, everything
    reached `main`. Content-diffing against `main` doesn't answer it either — `main` moves on, so
    a file this branch added and a later PR deleted looks exactly like work that never merged.
  - **`git worktree remove` exits 0 when it fails.** On these deep `node_modules` paths it dies
    with "Filename too long", unregisters the worktree, and leaves the directory behind. It always
    needs an `rm -rf` + `git worktree prune` follow-up.
- Before stopping the *shared* `worktrac-sqlserver` container: run `git worktree list`.
- Before force-pushing/rebasing a branch, check `.claude/worktrees/` for sibling worktrees that may
  still be mid-task on a related branch.
- Before concluding "my uncommitted changes are missing": check `git reflog` and
  `git worktree list` — a sibling session may have already committed and merged it.

## Environment
- Spring profiles: `local` for development, `lower` for lower env, `production` for prod.
- **Local SQL Server is on host port 1434, not 1433.** This machine already runs another
  project's `inttime-sqlserver` on 1433, so `worktrac-sqlserver` is mapped `-p 1434:1433` and
  `application-local.yml` points at `localhost:1434`. Don't "fix" this back to 1433.
  **All worktrees share this one container** — isolation comes from each using its own *database*
  on it, not separate containers.
- Every git worktree gets its own backend port, frontend port, and database, so multiple sessions
  run side by side. The primary `main` worktree keeps `:8080`/`:3000`. Don't start the
  backend/frontend manually with hardcoded ports outside the primary worktree — use
  `scripts/up.sh` (or `/run-local`). Design + troubleshooting: `docs/DEVELOPMENT.md`.
- **NEVER commit passwords, tokens, or connection strings to code.**
- Lower and production SQL Databases are on the Basic tier (switched 2026-07-18 from serverless
  auto-pause, which added cold-start delays). Production Container Apps run `min-replicas=1`
  (always warm); lower still scales to 0, so cold starts are possible there.
- **Azure is readable, not writable.** A Reader/Monitoring Reader/Log Analytics Reader service
  principal lets `az` inspect container app status, revisions, and metrics for lower and prod.
  Container logs come from KQL against the `worktrac-logs` workspace, *not*
  `az containerapp logs show`. Setup, queries, and what's deliberately out of reach (SQL data,
  Key Vault secrets): `docs/azure-read-only-access.md`.

## Pipeline & Setup History
The full SDLC/DevOps setup guide — the reasoning behind CI/CD design, custom domains, branch
protection, security scanning, and fixes like the deploy-time config.json correction and the
testcontainers-bom / Docker Engine version pin — lives one level up at
`../worktrac_SDLC_setup_guide.md`. It is **not** inside this repo, so open the parent folder in
VS Code if you need it. Check it for the "why" behind existing pipeline/infra configuration
before changing it.

## Deeper context

Detailed subsystem invariants live in `.claude/rules/*.md` and **load automatically** when you
touch matching files — you don't need to open them manually. Full narratives are in `docs/`:

| Topic | Auto-loading rule | Full narrative |
|---|---|---|
| **Degraded-conditions contract (all code)** | `resilience.md` | `docs/architecture/resilience.md` |
| Backend-wide (person scoping, `Clock`, error handling) | `backend-core.md` | — |
| Workout data model (`rest_seconds`, idempotency, notes, picker) | `workout-data-model.md` | `docs/architecture/data-model.md` |
| Registration, auth & the async email pipeline | `registration-and-email.md` | `docs/architecture/admin-portal.md` |
| Admin portal | `admin-portal.md` | `docs/architecture/admin-portal.md` |
| Flyway migrations | `flyway-tsql.md` | — |
| Frontend state (per-person isolation, query cache) | `frontend-core.md` | `docs/architecture/frontend-state.md` |
| Design system (tokens, primitives, contrast, motion) | `frontend-core.md` | `docs/architecture/design-system.md` |
| Offline mode & the durable outbox | `offline-internals.md` | `docs/architecture/offline-mode.md` |
| Log screen (`ExerciseDetail.jsx`) | `log-screen.md` | — |
| Trends & stats (bodyweight lifts, ranges, chart rules) | `trends.md` | `docs/architecture/trends.md` |
| Backend / frontend / e2e testing | `backend-tests.md`, `frontend-tests.md`, `e2e-tests.md` | `docs/architecture/testing.md` |

Past bugs that were expensive to find — read the relevant one before changing that area:
`docs/incidents/` (indexed in its `README.md`).

## Where new documentation goes

**Keep this file small.** It loads on every single request, and a bloated CLAUDE.md causes real
instructions to get ignored. It was once 84 KB; almost all of that is now in the tiers below.

Route new documentation to the **narrowest** place that fits:

| What you're adding | Where it goes |
|---|---|
| An invariant a future change must not break | The matching `.claude/rules/*.md` — add `paths:` frontmatter so it only loads for relevant files |
| Narrative, rationale, or design discussion | `docs/architecture/` |
| A post-mortem for a bug that was hard to find | A new `docs/incidents/YYYY-MM-DD-slug.md` + a row in its `README.md` |
| A rule that genuinely applies to **every** task | Here — and only then |

**Never paste subsystem detail back into this file.** If it exceeds ~250 lines, content is in the
wrong tier. Every rule file must carry `paths:` frontmatter — one without it loads unconditionally
and defeats the purpose.
