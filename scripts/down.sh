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
