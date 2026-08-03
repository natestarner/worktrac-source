# Local development: isolated per-worktree stacks

## The model

This project's workflow puts each logical change in its own git worktree under
`.claude/worktrees/<branch>/` (see `CLAUDE.md` → "Development Workflow"). Multiple worktrees —
and therefore multiple Claude sessions or developers — commonly work at the same time. Local
dev is designed so each worktree gets its **own fully isolated stack** with zero collision:

- **One shared SQL Server container, one database per worktree.** All worktrees share a
  single `worktrac-sqlserver` container (host port 1434) — that's deliberate: running a
  separate SQL Server *container* per worktree is exactly what exhausted the host's async-I/O
  budget and crashed every instance when backend test parallelism was first attempted (see
  `backend/src/test/resources/junit-platform.properties`'s history). Isolation instead comes
  from each worktree using its own **database** (`worktrac_<slug>`) on that one shared server.
  The primary `main` worktree keeps the original database name `worktrac`.
- **Backend + frontend run on the host, on ports derived per worktree.** Not containerized —
  native Spring Boot / Vite processes give the best hot-reload experience on Windows and avoid
  the file-watching lag that Docker bind-mounts have over WSL2. The primary `main` worktree
  keeps the historical ports (backend `:8080`, frontend `:3000`); every other worktree is
  assigned the next free ports starting from `8081`/`3001` the first time it starts its stack,
  and reuses the same ports on every later run (persisted in a gitignored `.env.worktree` in
  that worktree's own directory).

## One-command interface

Everything is driven through `scripts/*.sh` (portable `bash`, work the same in Git Bash or
WSL), fronted by two Claude Code skills:

| Action | Skill | Underlying script |
|---|---|---|
| Start this worktree's stack | `/run-local` | `bash scripts/up.sh` |
| Stop this worktree's stack | `/stop-local` | `bash scripts/down.sh` |
| Check what's running | — | `bash scripts/status.sh` |
| Sanity-check the environment | — | `bash scripts/doctor.sh` |
| Reset just this worktree's database | — | `bash scripts/db-reset.sh` |

All of these are worktree-scoped automatically: run any of them from within a given worktree
and they only ever touch that worktree's own ports, processes, and database — never another
worktree's.

## How it works

1. `scripts/worktree-env.sh` (sourced by every other script) figures out which worktree you're
   in from the current git branch, and either loads or allocates `BACKEND_PORT`,
   `FRONTEND_PORT`, and `DB_NAME`, then exports the environment variables the app already reads
   for these (`SPRING_DATASOURCE_URL`, `SERVER_PORT`, `CORS_ALLOWED_ORIGINS`,
   `APP_EMAIL_APP_URL`, and the frontend's `FRONTEND_PORT`/`VITE_BACKEND_ORIGIN`).
2. `scripts/db.sh` ensures the shared `worktrac-sqlserver` container is running (starting the
   existing one, or — on a brand-new machine with no such container yet — creating it from
   `compose.yaml`), then creates this worktree's database if it doesn't already exist. Flyway
   migrates it on the backend's next boot, same as it always has.
3. `scripts/up.sh` stops anything already bound to this worktree's own ports (safe to re-run),
   then starts the backend (`mvn spring-boot:run -Dspring-boot.run.profiles=local`) and
   frontend (`npm run dev`) with the derived env vars, logging to `.dev-logs/` **inside this
   worktree** (not the old shared `/c/tmp` location, which is exactly what caused sibling
   sessions to overwrite each other's logs before).

## Running tests

- `mvn verify` (backend) and `npm test` (frontend) don't need the dev stack running — see
  `backend/src/test/java/.../support/AbstractIntegrationTest.java` for how backend integration
  tests get their own isolated database via Testcontainers, independent of your local stack.
- `bash scripts/e2e.sh` runs Playwright e2e against **this worktree's own** running stack
  (`E2E_BASE_URL=http://localhost:<FRONTEND_PORT>`) — see the e2e section of
  `.claude/commands/deploy-to-lower.md` for the full flow.

## One-time host setup (optional, for backend test parallelism)

Once backend test class parallelism is re-enabled (see `junit-platform.properties`), running
several Testcontainers-backed JVM forks at once benefits from more `fs.aio-max-nr` headroom in
the Docker Desktop WSL2 VM. This is optional — the single shared local dev database above
doesn't need it, only concurrent backend test runs do:

```bash
wsl.exe -d docker-desktop -- sh -c 'echo "fs.aio-max-nr = 1048576" >> /etc/sysctl.conf && sysctl -p'
```

`bash scripts/doctor.sh` reports the current value and warns if it looks low.

## Troubleshooting

- **"Port already in use" / stack came up on the wrong port:** run `bash scripts/status.sh` to
  see what's actually listening on this worktree's expected ports, then `bash scripts/down.sh`
  before retrying.
- **Lost track of which ports a worktree uses:** check `.env.worktree` in that worktree's own
  directory, or just run `bash scripts/status.sh` from inside it.
- **Need a clean database for this worktree:** `bash scripts/db-reset.sh` — drops and
  recreates only this worktree's database; Flyway rebuilds it from the migrations on the
  backend's next start.
- **Concurrent sessions stepping on each other:** see `CLAUDE.md` → "Concurrent Sessions" — with
  this isolation model in place, port/database collisions between worktrees should no longer
  happen; if they do, check `.env.worktree` in each worktree for a genuine slug collision
  (very unlikely — slugs are derived from branch names, and one worktree = one branch).
