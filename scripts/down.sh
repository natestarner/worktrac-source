#!/usr/bin/env bash
# Stops THIS worktree's backend + frontend only. Finds whatever is actually LISTENING on
# this worktree's own derived ports and kills it by PID -- never by image name (that would
# kill unrelated java/node processes elsewhere on the machine, including a SIBLING
# worktree's own stack). Because every worktree has its own ports, killing by port is
# inherently scoped to just this one. The shared SQL Server container is left running --
# other worktrees may depend on it.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-env.sh"

# Breadcrumb for the death ledger: anything killed from here is INTENTIONAL, and the ledger needs
# to know. Without it every /run-local, /stop-local and `e2e.sh --restart` writes two entries, so
# routine stops outnumber real deaths by a wide margin and the one occurrence worth reading is
# buried -- which defeats the point of keeping the ledger at all.
# Written BEFORE the kill, because the dying server's wrapper reads it as it exits.
# record-memory-state.sh treats a sentinel younger than 60s as "planned"; up.sh deletes it once the
# replacement stack is confirmed listening, so this window can never leak into a later real death.
LOG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/.dev-logs"
mkdir -p "$LOG_DIR"
: > "$LOG_DIR/.planned-stop"

pids=$(netstat -ano | grep -E ":(${BACKEND_PORT}|${FRONTEND_PORT})[[:space:]].*LISTENING" | awk '{print $NF}' | sort -u || true)

if [ -z "$pids" ]; then
  echo "Nothing listening on :$BACKEND_PORT or :$FRONTEND_PORT (worktree '$WORKTREE_SLUG') -- already stopped."
else
  for pid in $pids; do
    echo "Stopping PID $pid"
    powershell.exe -NoProfile -Command "Stop-Process -Id $pid -Force" 2>/dev/null || true
  done
fi

echo "Worktree '$WORKTREE_SLUG' stack stopped. Shared SQL Server container left running."
