---
description: Stop THIS worktree's local dev stack (backend + frontend). Leaves the shared SQL Server container running since other worktrees may depend on it. Use when the user says "stop local", "stop the dev servers", "tear down local", "shut down local dev", or similar.
---

# /stop-local

Stop this worktree's backend + frontend dev servers. Run **fully autonomously** — this only
touches local processes bound to this worktree's own ports.

## Steps

### 1. Find the repo root
`REPO_ROOT=$(git rev-parse --show-toplevel)` — run from wherever the session currently is.

### 2. Run the down script
```bash
cd "$REPO_ROOT" && bash scripts/down.sh
```
This finds whatever is listening on *this worktree's own* backend/frontend ports (derived the
same way `/run-local` derives them) and stops it by PID. It never touches another worktree's
processes, and it never stops the shared `worktrac-sqlserver` container — other worktrees may
still be using it.

### 3. Confirm
Report that this worktree's stack is stopped. If the user wants the shared database container
stopped too (rare — it's shared infrastructure other worktrees may depend on), confirm with
them explicitly before running `docker stop worktrac-sqlserver`.
