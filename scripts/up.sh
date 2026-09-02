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
#     theory.
#   * It reproduces only under sustained parallel load (`--workers=2` full suite); a `--workers=1`
#     full suite completed with the server still serving.
#
# 2026-08-16 -- THE rc=127 READING ABOVE WAS WRONG, and it sent two investigations down a dead end.
# It used to continue: "...and rules in 'npm returned on its own'... 127 points at the npm ->
# npm.cmd -> node shim chain losing its console/child under Git-for-Windows". Both halves are false,
# and this was established by experiment rather than argument:
#   * MEASURED: kill the Vite process directly (`Stop-Process -Id <pid> -Force`, which is a Windows
#     TerminateProcess and touches nothing else) and the wrapper survives and records EXACTLY
#     `[[frontend exited rc=127]]`. Reproduced three times, including via down.sh's own
#     netstat-based kill. So rc=127 is precisely what an EXTERNAL KILL of the child looks like here.
#     "Wrapper alive, therefore it exited on its own" does not follow: killing the child alone
#     always leaves the wrapper alive to report.
#   * MEASURED: 127 still appears with npm removed from the launch path entirely -- the frontend was
#     temporarily launched as `node node_modules/vite/bin/vite.js`, no npm and no .bin shim, and an
#     external kill still produced exactly 127. A theory that blames the npm shim cannot explain a
#     code produced when no npm shim is involved. (That launch change has since been reverted --
#     see the note at the frontend launch below for why it wasn't worth keeping on its own.)
#   * CONSEQUENCE: rc=127 DOES NOT DISCRIMINATE between "exited on its own" and "was killed". Any
#     future reasoning that leans on it to answer that question is unsound. The `mem-at-exit` line
#     recorded next to it (see _record_exit) is what carries actual information now.
#
# 2026-08-18 -- SOLVED. It is not memory, and the frontend/backend asymmetry below is explained by
# process ANCESTRY, not by how the JVM and node allocate. Vite was never detached in the first
# place:
#   * `setsid` does not exist in stock Git-for-Windows, so `_detach` degrades to bare `nohup` --
#     which ignores SIGHUP but leaves the child INSIDE the launching shell's process tree. The
#     fallback branch below says so out loud; what was missed is that this is the whole bug.
#   * MEASURED with a 1-second process-chain poll across a reproduction: the ENTIRE chain vanished
#     within one tick --
#         bash <- bash <- npm(node) <- cmd <- vite(node)
#     both bash shells included. Vite was never singled out; the shell tree was torn down and Vite
#     went with it. That is also why rc=127 shows up: per the 2026-08-16 block, 127 is what an
#     externally terminated child looks like here.
#   * The backend survives the same teardown BY ACCIDENT: Maven forks the Spring Boot JVM into a
#     process whose parent has already exited, so the real server is orphaned and out of the tree
#     before any teardown can reach it. Nothing to do with heap-vs-continuous allocation.
#   * RULED OUT, with instruments rather than argument: host commit-charge exhaustion (Windows has
#     logged ZERO Microsoft-Windows-Resource-Exhaustion-Detector events, ever, and commit sat at
#     49-60% at every recorded death); and a crash (ZERO Application Error / Windows Error
#     Reporting events in the death window -- so node was terminated, not faulted).
#   * Why it bites agent sessions hardest, and why "use separate shell invocations" was never a
#     usable workaround there: Claude Code keeps ONE persistent shell across every command, so
#     up.sh and the test run always share it. The advice is unfollowable by construction.
#   * FIX: the frontend launches through scripts/detach-launch.js, which uses node's
#     spawn({detached:true}) (DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP on Windows). Verified the
#     chain root's parent is dead afterwards -- the same orphaned shape Maven gives the backend --
#     and a full e2e suite then completed with the SAME vite pid still serving. The backend is
#     deliberately left alone: it already escapes, and changing its launch is what got the
#     PowerShell Start-Process attempt reverted twice.
#
# SUPERSEDED by the 2026-08-18 block above, kept because the measurement in it is still true and
# still worth knowing: a full suite at 11 workers drove Windows commit to 98.8% of a 49.59 GB limit
# while free physical RAM still read 4.3 GB -- so free RAM is the wrong instrument for memory
# pressure here, and "7+ GB free throughout" never justified striking OOM off the list. What that
# pass got wrong was the conclusion: commit pressure is not what terminates the frontend (every
# recorded death sits at 49-60% commit, and Windows has never logged a resource-exhaustion event),
# and the frontend/backend asymmetry is process ancestry, not JVM-vs-node allocation behaviour.
# Keep the 11-worker number in mind as a REASON NOT TO RAISE E2E_WORKERS on this host; do not
# reach for it to explain a dead dev server.
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
#
# It now also records WHY, not just THAT. The rc alone left the real question open for months: 127
# is a shell "command not found", which says the exit came from the process-spawn layer but not
# what starved it. A second line -- `[[<name> mem-at-exit]] commit=..%` -- captures host commit
# charge at that instant (see scripts/record-memory-state.sh for why commit and not free RAM).
#
# ORDER MATTERS. `echo` is a bash BUILTIN, so the rc line needs no fork and lands even on a host
# too starved to spawn anything; the snapshot after it spawns PowerShell and may legitimately fail
# under that same pressure. Never reorder these so a failing snapshot can cost us the rc line.
# `rc=$?` is captured immediately for the same reason -- anything in between clobbers it.
# The slug is baked in at launch time so the SHARED ledger can attribute a death to the worktree it
# came from -- `$rc` stays literal here on purpose, for the inner shell to expand when it fires.
_record_exit() {
  printf '%s; rc=$?; { echo "[[%s exited rc=$rc at $(date +%%Y-%%m-%%dT%%H:%%M:%%S)]]"; bash "%s/record-memory-state.sh" %s %s $rc; } >> "%s/%s.log" 2>&1' \
    "$1" "$2" "$SCRIPT_DIR" "$2" "$WORKTREE_SLUG" "$LOG_DIR" "$2"
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
# A known-bad Node build is the one failure mode that looks exactly like a code regression, so
# say so BEFORE anything starts rather than after an e2e run has gone red.
bash "$SCRIPT_DIR/check-node-version.sh" || true

_open_log backend.log
_open_log frontend.log

# Stripe is passed THROUGH from the developer's shell, never stored in the repo -- a sandbox
# secret key is still a real credential, so application-local.yml deliberately has no value for
# it (unlike the placeholder ACS/JWT values there, which are inert). Export these before running
# this script to exercise billing:
#
#   export STRIPE_SECRET_KEY=sk_test_...   STRIPE_PUBLISHABLE_KEY=pk_test_...
#   export STRIPE_PRICE_MONTHLY=price_...  STRIPE_PRICE_YEARLY=price_...
#   export STRIPE_WEBHOOK_SECRET=whsec_... # printed by `stripe listen`, NOT the Dashboard one
#
# With none set, billing degrades to "unavailable" (an honest 503) and everything else runs
# normally -- the right default for worktrees that do not care about billing. STRIPE_RETURN_URL
# defaults to THIS worktree's frontend port, so the post-checkout return lands on the stack you
# are actually running rather than the primary worktree's :3000.
echo "Starting backend..."
cd "$REPO_ROOT/backend"
SPRING_DATASOURCE_URL="$SPRING_DATASOURCE_URL" \
SERVER_PORT="$BACKEND_PORT" \
CORS_ALLOWED_ORIGINS="$CORS_ALLOWED_ORIGINS" \
APP_EMAIL_APP_URL="$APP_EMAIL_APP_URL" \
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}" \
STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-}" \
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-}" \
STRIPE_PRICE_MONTHLY="${STRIPE_PRICE_MONTHLY:-}" \
STRIPE_PRICE_YEARLY="${STRIPE_PRICE_YEARLY:-}" \
STRIPE_RETURN_URL="${STRIPE_RETURN_URL:-http://localhost:$FRONTEND_PORT/app/billing}" \
  _detach bash -c "$(_record_exit 'mvn spring-boot:run -Dspring-boot.run.profiles=local' 'backend')" \
  >> "$LOG_DIR/backend.log" 2>&1 &
disown

echo "Starting frontend..."
cd "$REPO_ROOT/frontend"
[ -d node_modules ] || npm install
# TRIED AND REVERTED 2026-08-16 -- don't redo it without new evidence. This launched Vite as
# `node node_modules/vite/bin/vite.js`, bypassing both npm and node_modules/.bin/vite, to test the
# then-current theory that rc=127 came from the npm shim chain losing its child under
# Git-for-Windows. The experiment KILLED that theory rather than confirming it: 127 still appears
# with npm absent entirely, because 127 is simply what an externally-terminated child looks like
# here (see the 2026-08-16 block above). With its motivation gone, the direct call was left with
# only a marginal upside -- one fewer node process, ~60 MB -- against two real costs: package.json
# stops being the source of truth for how the dev server starts, so a later `vite --host` or
# NODE_OPTIONS added to the "dev" script would be silently ignored; and a hardcoded bin path breaks
# on a Vite major that relocates it. Not worth it. Keep `npm run dev`.
# Launched through detach-launch.js rather than `_detach` (see that file's header for the full
# root cause). `setsid` is absent here, so `_detach` is bare `nohup`, which leaves Vite inside the
# launching shell's process tree -- and when that tree is torn down, Vite dies with it, which is
# the rc=127 mid-run death this project chased through three wrong theories. node's
# spawn({detached:true}) is what actually leaves the tree. Still `npm run dev`, still wrapped by
# _record_exit, so package.json stays the source of truth and the death ledger still gets its
# entry; only the detachment changed.
# Fail FAST and legibly if the launcher is missing (e.g. a worktree created from a commit that
# took up.sh but not detach-launch.js -- they must ship together). Without this the frontend simply
# never starts and you wait out wait_for_url's 150s timeout, which then tails a log the launcher
# never got to write, i.e. the least informative possible failure.
if [ ! -f "$SCRIPT_DIR/supervise-server.js" ]; then
  echo "up.sh: FATAL -- scripts/supervise-server.js is missing." >&2
  echo "  It records the frontend's real exit code; without it a death is untypeable." >&2
  exit 1
fi
if [ ! -f "$SCRIPT_DIR/detach-launch.js" ]; then
  echo "up.sh: FATAL -- scripts/detach-launch.js is missing." >&2
  echo "  The frontend is launched through it so Vite gets its own console/process group and" >&2
  echo "  cannot be killed by a console CTRL event aimed at the shell that started it." >&2
  echo "  It must be committed alongside this script. See its header for why." >&2
  exit 1
fi

# The frontend is supervised by NODE, not wrapped in bash, and that is load-bearing rather than
# stylistic. bash collapses every abnormal end to exit 127: measured on 2026-09-01, an external
# `Stop-Process -Force` (native 0xFFFFFFFF) and a fail-fast abort inside Vite (native 0xC0000409)
# both reach bash as wait status 32512. Those are two COMPLETELY different bugs, and for months
# the ledger recorded both as an identical "rc=127", which is why four investigations each picked
# a different single cause and none of them held.
#
# A bash wrapper also could not write the marker at all: Git Bash's bash.exe, spawned with
# DETACHED_PROCESS by detach-launch.js, silently discards its own stdout, while a native Windows
# child writing the SAME inherited handle succeeds. So Vite's output landed, the log looked
# healthy, and the `[[frontend exited ...]]` line e2e.sh tells you to look for was never once
# written. supervise-server.js is node, so its writes land, and it reports the child's REAL exit
# code and names the mechanism. See its header.
FRONTEND_PORT="$FRONTEND_PORT" VITE_BACKEND_ORIGIN="$VITE_BACKEND_ORIGIN" \
  node "$SCRIPT_DIR/detach-launch.js" "$LOG_DIR/frontend.log" \
    node "$SCRIPT_DIR/supervise-server.js" "$LOG_DIR/frontend.log" frontend "$WORKTREE_SLUG" "$SCRIPT_DIR" \
      npm run dev > /dev/null

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

# The sentinel is deliberately NOT deleted here -- it ages out on record-memory-state.sh's own 60s
# window instead.
#
# Deleting it eagerly is what made the death ledger untrustworthy (measured 2026-09-01). The dying
# server records its own exit ASYNCHRONOUSLY, and under load that lag is tens of seconds: a stop
# timed at 20:33:17, 1.3s after down.sh wrote the sentinel, did not reach the ledger until
# 20:33:44. By then this line had already removed the breadcrumb -- because both ports were
# answering again ~20s in -- so an ordinary `/run-local` restart was filed as an UNEXPECTED death.
#
# That inflated the ledger badly enough to send four separate investigations after a phantom: 23 of
# the "unexpected" frontend deaths have chrome=0, i.e. no test run in flight at all, which is
# exactly what a routine restart looks like. One batch shows four servers across three worktrees
# dying inside the same second -- a machine-wide shutdown, all recorded as unexpected.
#
# The 60s age check already does the job this deletion was reaching for: a server dying a minute
# from now cannot inherit this restart's intent, because the sentinel will have aged past the
# window. Letting it expire naturally is both sufficient and correct.

echo ""
echo "=== Worktree '$WORKTREE_SLUG' is up ==="
echo "  backend  -> http://localhost:$BACKEND_PORT"
echo "  frontend -> http://localhost:$FRONTEND_PORT"
