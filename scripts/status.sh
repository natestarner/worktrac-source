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
