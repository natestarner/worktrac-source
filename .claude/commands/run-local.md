---
description: Spin up this worktree's own isolated local dev stack (shared SQL Server container + this worktree's own database, backend, frontend) so the app can be exercised in a browser. Safe to run alongside other worktrees' stacks -- each gets its own ports/database. Also the way to restart a stale local run for this worktree. Use when the user says "run it locally", "run in local", "spin up local dev", "start the app locally", "test this in local", or similar.
---

# /run-local

Get the app running locally so the user can open it in a browser and click around. Run
**fully autonomously** through the steps below — don't ask for confirmation, this only
touches local processes and a local Docker container, nothing shared or remote.

## Facts this relies on (see `CLAUDE.md` and `docs/DEVELOPMENT.md`)

- Every worktree gets its **own backend port, frontend port, and database**, derived
  deterministically from the worktree's branch name (`scripts/worktree-env.sh`). The primary
  `main` worktree always gets the historical **3000/8080/`worktrac`**; every other worktree
  gets its own ports in the 3001+/8081+ ranges and its own `worktrac_<slug>` database, picked
  the first time `scripts/up.sh` runs there and then reused. This means **running `/run-local`
  in two different worktrees at the same time is safe** — they will not collide.
- All worktrees share **one** SQL Server container (`worktrac-sqlserver`, host port 1434) —
  isolation between worktrees comes from each having its own *database* on that one server,
  not from separate containers. A *different* project's container, `inttime-sqlserver`, also
  runs on this machine on the standard port **1433** — never stop, start, or otherwise touch
  that one.
- `mvn spring-boot:run` forks a separate `java` process and `npm run dev` forks a separate
  `node`/vite process; both outlive their launching shell if it's killed. `scripts/down.sh`
  (called by `scripts/up.sh` before it starts anything) frees a port by killing whatever
  process is actually bound to it, found via `netstat` — never by image name, and never a
  port belonging to another worktree.

## Steps

### 1. Find the repo root
`REPO_ROOT=$(git rev-parse --show-toplevel)` — run this from wherever the session currently
is (main checkout or any worktree); it returns *that* worktree's own root.

### 2. Run the up script
```bash
cd "$REPO_ROOT" && bash scripts/up.sh
```
Run this via the Bash tool with `run_in_background: true` — it backgrounds the backend and
frontend itself and returns immediately after kicking both off. It prints which ports and
database this worktree is using; note them for the next step. It's safe to re-run any time,
including while a previous run's servers (for this same worktree) are still up.

### 3. Poll for readiness
Using the ports `scripts/up.sh` printed:
- Backend: poll `http://localhost:<BACKEND_PORT>/actuator/health` (or tail
  `.dev-logs/backend.log` for `Started BackendApplication`) — allow up to ~90s on a cold Maven
  dependency resolution.
- Frontend: poll `http://localhost:<FRONTEND_PORT>` (or tail `.dev-logs/frontend.log` for
  `ready in`). **Confirm the log's `Local:` line matches the expected port** — if it doesn't,
  something is still holding that port; check `bash scripts/status.sh` rather than continuing
  on the wrong port.

If either fails to come up, read its log under `.dev-logs/` and report the actual error rather
than retrying blindly.

### 4. Report readiness
Tell the user (using this worktree's actual ports):
- Frontend: `http://localhost:<FRONTEND_PORT>`
- Backend health: `http://localhost:<BACKEND_PORT>/actuator/health`
- Database: `<DB_NAME>` on the shared `worktrac-sqlserver` container (port 1434)

Leave both dev servers running in the background — that's the point, so the user can use the
app. Don't tear them down at the end of this command; use `/stop-local` for that.

## Notes

- Local dev has no hot-reload for new/changed backend endpoints — if the user edits backend
  code after this command finishes, re-run `/run-local` (or at least restart the backend) to
  pick the change up.
- This command only starts the app for manual browsing. It does not run the test suites or
  Playwright e2e — for that, see `mvn verify`, `npm test`, and `scripts/e2e.sh` /
  `.claude/commands/deploy-to-lower.md`.
- `bash scripts/doctor.sh` and `bash scripts/status.sh` are useful for diagnosing "why didn't
  this come up" without re-running the whole stack.
