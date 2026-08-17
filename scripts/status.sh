#!/usr/bin/env bash
# Reports THIS worktree's port/PID/database state -- useful for checking whether a stack is
# already running before starting another, especially when multiple worktrees are active.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-env.sh"

echo "Worktree '$WORKTREE_SLUG': backend :$BACKEND_PORT | frontend :$FRONTEND_PORT | db $DB_NAME"
echo ""
echo "-- Listening on this worktree's ports --"
netstat -ano | grep -E ":(${BACKEND_PORT}|${FRONTEND_PORT})[[:space:]].*LISTENING" || echo "(nothing listening -- stack is stopped)"
echo ""
echo "-- Shared SQL Server container --"
docker ps --filter "name=worktrac-sqlserver" --format '{{.Names}}: {{.Status}}' || echo "(not running)"

# Deaths recorded by up.sh's _record_exit. e2e.sh already surfaces these, but ONLY when a suite was
# running at the time -- a server that dies during manual browsing otherwise goes unnoticed until
# someone happens to open the log. This makes "did my frontend die, and what was the machine doing?"
# answerable in one command.
echo ""
echo "-- Recorded server deaths (most recent last) --"
LOG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/.dev-logs"
found=0
for name in backend frontend; do
  log="$LOG_DIR/$name.log"
  [ -f "$log" ] || continue
  # -a: these logs carry ANSI/CR bytes from Vite's banner, which makes grep treat them as binary
  # and print "binary file matches" instead of the line we came for.
  if lines=$(grep -aE "\[\[$name (exited|mem-at-exit)" "$log" | tail -4) && [ -n "$lines" ]; then
    echo "$lines"
    found=1
  fi
done
[ "$found" -eq 1 ] || echo "(none recorded -- no server has exited since these logs began)"
echo ""
echo "Across ALL worktrees, with a verdict on whether memory explains them:"
echo "  bash scripts/deaths.sh"
