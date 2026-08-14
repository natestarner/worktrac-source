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
# 2026-08-09 -- what the exit instrumentation below finally pinned down, and what it rules out:
#   * A recorded `[[frontend exited rc=127 at ...]]` line was captured. That line is echoed by the
#     `bash -c` WRAPPER, so the wrapper was still alive when npm returned -- i.e. the process GROUP
#     was not signalled. This rules out "something SIGKILLed the group", which had been the leading
#     theory, and rules in "npm returned on its own".
#   * rc=127 is a shell "command not found", not a crash: no Vite/node stack trace, no error output,
#     nothing in the log after the ready banner. A JS OOM would print a heap trace and exit 134;
#     a signal would be 128+n. 127 points at the `npm` -> `npm.cmd` -> node shim chain losing its
#     console/child under Git-for-Windows, not at Vite or the app.
#   * It reproduces only under sustained parallel load (`--workers=2` full suite); a `--workers=1`
#     full suite completed with the server still serving.
# So: still unresolved as a root cause, but the failure is now known to be a self-exit in the npm
# shim layer rather than an external kill or an application crash. Don't re-litigate the group-kill
# theory without new evidence.
#
# A PowerShell Start-Process launcher was tried as a setsid substitute and REVERTED: it could not
# be shown to start the backend reliably, and trading a working start for an unverified fix to an
# intermittent death is the wrong bet. (Retried 2026-08-09 for the frontend alone; the dev server
# still died mid-run, so it is not a workaround either.) Separate `up.sh` from the test run if you
# need a long run to survive -- and run the suite through scripts/e2e.sh, which detects this exact
# death and says so instead of leaving it to look like a code regression:
#     bash scripts/up.sh      # one shell invocation
#     bash scripts/e2e.sh     # a separate one; reuses the healthy stack
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

# Each server's command is wrapped so its exit is RECORDED in its own log. A dev server that
# vanishes mid-run is otherwise indistinguishable from one that was hard-killed: both leave a log
# that simply stops. With this, the next occurrence answers its own first question --
#   "[[backend exited rc=N ...]]" present -> it exited on its own; rc and the lines above say why
#   line absent, process gone            -> something killed it (SIGKILL leaves no trace)
# which is exactly the fork that went unanswered while this was being chased.
_record_exit() {
  printf '%s; echo "[[%s exited rc=$? at $(date +%%T)]]"' "$1" "$2"
}

# ...but the marker above is only useful if it OUTLIVES the death it describes, and until
# 2026-08-13 it never did. These logs were opened with `>`, which truncates. The sequence that
# matters is: frontend dies mid-run -> e2e.sh finds the port dead -> e2e.sh calls up.sh ->
# up.sh truncates frontend.log -> the marker explaining the death is gone before anyone reads it.
# Since e2e.sh restarts a dead stack automatically, that erasure was GUARANTEED to happen on the
# exact occasions the marker was written for. The diagnostic that exists to answer "did it exit or
# was it killed?" had therefore never once been read -- which is a large part of why that question
# stayed open (see docs/incidents/2026-08-13-e2e-parallel-flakiness.md).
#
# So: append, with a banner delimiting each start. Rotate at 20MB so this can't grow without bound
# on a long-lived worktree; one full e2e run is ~1k lines now that show-sql defaults off.
_open_log() {
  local log="$LOG_DIR/$1"
  if [ -f "$log" ] && [ "$(wc -c < "$log")" -gt 20971520 ]; then
    mv -f "$log" "$log.1"
  fi
  {
    echo ""
    echo "=============================================================================="
    echo "[[$1 started at $(date '+%Y-%m-%d %H:%M:%S') -- worktree '$WORKTREE_SLUG']]"
    echo "=============================================================================="
  } >> "$log"
}
_open_log backend.log
_open_log frontend.log

echo "Starting backend..."
cd "$REPO_ROOT/backend"
SPRING_DATASOURCE_URL="$SPRING_DATASOURCE_URL" \
SERVER_PORT="$BACKEND_PORT" \
CORS_ALLOWED_ORIGINS="$CORS_ALLOWED_ORIGINS" \
APP_EMAIL_APP_URL="$APP_EMAIL_APP_URL" \
  _detach bash -c "$(_record_exit 'mvn spring-boot:run -Dspring-boot.run.profiles=local' 'backend')" \
  >> "$LOG_DIR/backend.log" 2>&1 &
disown

echo "Starting frontend..."
cd "$REPO_ROOT/frontend"
[ -d node_modules ] || npm install
FRONTEND_PORT="$FRONTEND_PORT" VITE_BACKEND_ORIGIN="$VITE_BACKEND_ORIGIN" \
  _detach bash -c "$(_record_exit 'npm run dev' 'frontend')" >> "$LOG_DIR/frontend.log" 2>&1 &
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
