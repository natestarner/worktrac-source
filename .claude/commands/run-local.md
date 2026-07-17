---
description: Spin up the full local dev stack (SQL Server container, backend on :8080, frontend on :3000) so the app can be exercised in a browser. Kills whatever is already on those ports first, so it's also the way to restart a stale local run. Use when the user says "run it locally", "run in local", "spin up local dev", "start the app locally", "test this in local", or similar.
---

# /run-local

Get the app running locally so the user can open it in a browser and click around. Run
**fully autonomously** through the steps below — don't ask for confirmation, this only
touches local processes and a local Docker container, nothing shared or remote.

## Facts this relies on (see `CLAUDE.md`)

- Frontend dev server must be on **port 3000** — local CORS only allows that origin
  (`CorsConfig.java` / `CORS_ALLOWED_ORIGINS`). If Vite reports a different port, something
  else grabbed 3000 first; that's a bug in this runbook's port-clearing step, not something
  to work around by using the bumped port.
- Backend `local` profile listens on **port 8080** and expects SQL Server on
  **`localhost:1434`** (`application-local.yml`), served by the Docker container
  `worktrac-sqlserver`. A *different* project's container, `inttime-sqlserver`, also runs on
  this machine on the standard port **1433** — never stop, start, or otherwise touch that
  one.
- `mvn spring-boot:run` forks a separate `java` process and `npm run dev` forks a separate
  `node`/vite process; both outlive their launching shell if it's killed. Freeing a port
  means killing whatever process is actually bound to it, found via `netstat`, not the
  wrapper command.

## Steps

### 1. Find the repo root
`REPO_ROOT=$(git rev-parse --show-toplevel)` — run this from wherever the session currently
is (main checkout or any worktree); the command works the same from any of them.

### 2. Free ports 3000 and 8080
Find whatever's currently listening on either port and kill it by PID — never by image name
(`taskkill /IM java.exe` etc. would kill unrelated Java/Node processes elsewhere on the
machine):

```bash
pids=$(netstat -ano | grep -E ":(3000|8080) .*LISTENING" | awk '{print $NF}' | sort -u)
for pid in $pids; do
  powershell.exe -NoProfile -Command "Stop-Process -Id $pid -Force"
done
```

Use `powershell.exe -NoProfile -Command "Stop-Process -Id <pid> -Force"` specifically —
Git Bash mangles `taskkill`'s `/T`/`/PID` flags via its automatic POSIX-to-Windows path
conversion, and piping through `cmd.exe /c` from this Bash tool has been unreliable (drops
into an interactive prompt instead of running and exiting). PowerShell's `Stop-Process`
avoids both problems.

### 3. Ensure the local SQL Server container is running
```bash
docker ps --format '{{.Names}}' | grep -qx worktrac-sqlserver || docker start worktrac-sqlserver
```
If this errors (container doesn't exist at all), stop and report — don't try to `docker run`
a replacement; that's an environment problem for the user to resolve, not something to
improvise around.

### 4. Start the backend
```bash
cd "$REPO_ROOT/backend"
mvn spring-boot:run -Dspring-boot.run.profiles=local > /c/tmp/worktrac-local-backend.log 2>&1
```
Run this via the Bash tool with `run_in_background: true`. Then poll
`/c/tmp/worktrac-local-backend.log` (or `curl http://localhost:8080/actuator/health`) until
you see `Started BackendApplication` / a 200 response — allow up to ~90s for a cold Maven
dependency resolution. If it doesn't come up, read the log and report the actual error rather
than retrying blindly.

### 5. Start the frontend
```bash
cd "$REPO_ROOT/frontend"
[ -d node_modules ] || npm install
npm run dev > /c/tmp/worktrac-local-frontend.log 2>&1
```
Also via `run_in_background: true`. Poll the log for `ready in` / `curl
http://localhost:3000`. **Confirm the log's `Local:` line says port 3000** — if it says
3001 or higher, port 3000 wasn't actually freed in step 2; go back and find what's still
holding it instead of continuing on the wrong port.

### 6. Report readiness
Tell the user:
- Frontend: http://localhost:3000
- Backend health: http://localhost:8080/actuator/health
- SQL Server: `worktrac-sqlserver` container, confirmed running on host port 1434

Leave both dev servers running in the background — that's the point, so the user can use the
app. Don't tear them down at the end of this command.

## Notes

- Safe to re-run any time, including while a previous run's servers are still up — step 2
  kills them first, so this doubles as "restart my stale local instance."
- Local dev has no hot-reload for new/changed backend endpoints — if the user edits backend
  code after this command finishes, re-run `/run-local` (or at least restart the backend) to
  pick the change up.
- This command only starts the app for manual browsing. It does not run the test suites or
  Playwright e2e — for that, see `mvn verify`, `npm test`, and the e2e section of
  `.claude/commands/deploy-to-lower.md` (which also needs `E2E_TEST_SUPPORT_KEY` set to the
  fixed value in `backend/src/main/resources/application-local.yml`).
