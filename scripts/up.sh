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

# Launch detached in their own session/process group where possible, rather than only immune to
# SIGHUP -- `nohup ... & disown` blocks SIGHUP but leaves the server in the launching shell's
# process group, so anything signalling that group takes it down.
#
# ⚠️ KNOWN UNRESOLVED: the Vite dev server still dies partway through a long e2e run launched from
# this script -- silently, nothing in its log, backend unaffected. Ruled out: OOM (7+ GB free
# throughout a monitored run), the dev proxy (survived 25 forced ECONNREFUSEDs), a spec killing
# processes (none shell out), and -- since worktree-env.sh started deconflicting ports -- a sibling
# worktree's down.sh, which was the previous (wrong) explanation given here. The surviving
# correlation is that it dies when up.sh and the long test run share one shell invocation, and
# survives when they are separated. setsid is the mitigation for that, but see the warning below.
#
# A PowerShell Start-Process launcher was tried as a setsid substitute and REVERTED: it could not
# be shown to start the backend reliably, and trading a working start for an unverified fix to an
# intermittent death is the wrong bet. Separate `up.sh` from the test run if you need a long run to
# survive: `bash scripts/up.sh` in one shell, `npx playwright test` in another.
if command -v setsid > /dev/null 2>&1; then
  _detach() { setsid nohup "$@"; }
else
  # Loudly, because this silently did nothing for a while and the servers kept dying: setsid is
  # absent from the stock Git-for-Windows bash this project is developed on.
  echo "up.sh: NOTE -- setsid not available; servers stay in this shell's process group and may be" >&2
  echo "  killed if a long-running command in the same shell is torn down. Start the stack from a" >&2
  echo "  separate invocation than your test run if that bites." >&2
  _detach() { nohup "$@"; }
fi

echo "Starting backend..."
cd "$REPO_ROOT/backend"
SPRING_DATASOURCE_URL="$SPRING_DATASOURCE_URL" \
SERVER_PORT="$BACKEND_PORT" \
CORS_ALLOWED_ORIGINS="$CORS_ALLOWED_ORIGINS" \
APP_EMAIL_APP_URL="$APP_EMAIL_APP_URL" \
  _detach mvn spring-boot:run -Dspring-boot.run.profiles=local > "$LOG_DIR/backend.log" 2>&1 &
disown

echo "Starting frontend..."
cd "$REPO_ROOT/frontend"
[ -d node_modules ] || npm install
FRONTEND_PORT="$FRONTEND_PORT" VITE_BACKEND_ORIGIN="$VITE_BACKEND_ORIGIN" \
  _detach npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
disown

echo ""
echo "Backend  -- log: $LOG_DIR/backend.log"
echo "Frontend -- log: $LOG_DIR/frontend.log"

# Actually wait, rather than printing a "poll ..." hint and returning immediately. Callers -- both
# `/run-local` and scripts/e2e.sh -- were left racing a stack that wasn't listening yet: on a cold
# Maven start the backend needs ~15s, so an e2e run kicked off straight after this returned would
# fail its first specs against a dead backend (ECONNREFUSED through Vite's proxy) and look for all
# the world like a code regression. Exiting non-zero on timeout means e2e.sh's `set -e` aborts
# instead of testing against a stack that never came up.
wait_for_url() {
  local label="$1" url="$2" log="$3" deadline=$((SECONDS + 150))
  printf 'Waiting for %s' "$label"
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -sf -o /dev/null --max-time 5 "$url"; then
      echo " -- ready."
      return 0
    fi
    printf '.'
    sleep 2
  done
  echo " -- TIMED OUT after 150s."
  echo "  $label never answered at $url. Last 20 lines of $log:" >&2
  tail -20 "$log" >&2
  return 1
}

wait_for_url "backend " "http://localhost:$BACKEND_PORT/actuator/health" "$LOG_DIR/backend.log"
wait_for_url "frontend" "http://localhost:$FRONTEND_PORT" "$LOG_DIR/frontend.log"

echo ""
echo "=== Worktree '$WORKTREE_SLUG' is up ==="
echo "  backend  -> http://localhost:$BACKEND_PORT"
echo "  frontend -> http://localhost:$FRONTEND_PORT"
