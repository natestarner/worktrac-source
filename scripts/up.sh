#!/usr/bin/env bash
# Starts THIS worktree's own isolated local stack: shared SQL Server container (creating it
# if this is a fresh machine) + this worktree's own database + backend (:$BACKEND_PORT) +
# frontend (:$FRONTEND_PORT). Safe to re-run any time -- it stops this worktree's own stale
# processes first (scripts/down.sh), then starts fresh. Never touches another worktree's
# ports, database, or processes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-env.sh"

echo "=== Worktree '$WORKTREE_SLUG' ==="
echo "  backend  -> http://localhost:$BACKEND_PORT"
echo "  frontend -> http://localhost:$FRONTEND_PORT"
echo "  database -> $DB_NAME (on the shared worktrac-sqlserver container)"
echo ""

"$SCRIPT_DIR/down.sh"
"$SCRIPT_DIR/db.sh"

LOG_DIR="$REPO_ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

echo "Starting backend..."
cd "$REPO_ROOT/backend"
SPRING_DATASOURCE_URL="$SPRING_DATASOURCE_URL" \
SERVER_PORT="$BACKEND_PORT" \
CORS_ALLOWED_ORIGINS="$CORS_ALLOWED_ORIGINS" \
APP_EMAIL_APP_URL="$APP_EMAIL_APP_URL" \
  nohup mvn spring-boot:run -Dspring-boot.run.profiles=local > "$LOG_DIR/backend.log" 2>&1 &
disown

echo "Starting frontend..."
cd "$REPO_ROOT/frontend"
[ -d node_modules ] || npm install
FRONTEND_PORT="$FRONTEND_PORT" VITE_BACKEND_ORIGIN="$VITE_BACKEND_ORIGIN" \
  nohup npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
disown

echo ""
echo "Backend starting  -- log: $LOG_DIR/backend.log  -- poll http://localhost:$BACKEND_PORT/actuator/health"
echo "Frontend starting -- log: $LOG_DIR/frontend.log -- poll http://localhost:$FRONTEND_PORT"
echo "(allow up to ~90s on a cold Maven dependency resolution)"
