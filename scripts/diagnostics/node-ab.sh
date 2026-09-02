#!/usr/bin/env bash
# A/B the dev server across Node.js builds under the real e2e load.
#
# This is the harness that identified the 2026-09-01 root cause (Node v24.15.0 corrupting its own
# stack on Windows -- see docs/incidents/2026-09-01-vite-dev-server-node-stack-corruption.md).
# Kept because the next suspect Node release will need exactly this, and rebuilding it from
# scratch under pressure is how the previous four investigations went wrong.
#
#   bash scripts/diagnostics/node-ab.sh <path-to-node.exe> <label> [attempts]
#
# Get a candidate build without touching the installed one (no admin required):
#   curl -o node.zip https://nodejs.org/dist/v24.20.0/node-v24.20.0-win-x64.zip
#   # extract just node.exe to a SHORT path -- the repo's own path is long enough that
#   # Expand-Archive hits Windows' 260-char limit on the full package.
#
# IMPORTANT -- interleave the arms. Run bad, good, then bad AGAIN. Sequential arms cannot
# distinguish "this build is broken" from "the machine got quieter", which is the confound that
# nearly let a wrong conclusion through on the day this was written.
#
# npm always uses the node.exe sitting beside it, so npm cannot select the version -- vite is
# launched directly from its bin. cwd is frontend/ so the script path stays relative and
# space-free, which matters because supervise-server.js uses a shell only for non-.exe targets.
set -u
cd "$(dirname "$0")/../.."
NODE_BIN="${1:?usage: node-ab.sh <path-to-node.exe> <label> [attempts]}"
LABEL="${2:-nodeab}"
ATTEMPTS="${3:-8}"

export E2E_TEST_SUPPORT_KEY="${E2E_TEST_SUPPORT_KEY:-local-dev-only-e2e-test-key-do-not-use-elsewhere}"
export E2E_WORKERS="${E2E_WORKERS:-11}"     # the crash needs real concurrency to show up
SCRIPT_DIR="$(cd scripts && pwd)"
LOG="$(pwd)/.dev-logs/frontend.log"
FRONTEND_PORT="${FRONTEND_PORT:-3003}"
VITE_BACKEND_ORIGIN="${VITE_BACKEND_ORIGIN:-http://localhost:8083}"
WORKTREE_SLUG="${WORKTREE_SLUG:-unknown}"

echo "== $LABEL == $("$NODE_BIN" --version) x $ATTEMPTS attempts, workers=$E2E_WORKERS"
crashes=0

for i in $(seq 1 "$ATTEMPTS"); do
  bash scripts/up.sh > /dev/null 2>&1
  # up.sh starts vite under the INSTALLED node; swap in the build under test.
  vpid=$(netstat -ano | grep ":${FRONTEND_PORT} " | grep LISTENING | awk '{print $NF}' | head -1)
  [ -n "$vpid" ] && powershell.exe -NoProfile -Command "Stop-Process -Id $vpid -Force" 2>/dev/null
  sleep 2

  ( cd frontend && FRONTEND_PORT="$FRONTEND_PORT" VITE_BACKEND_ORIGIN="$VITE_BACKEND_ORIGIN" \
      node "$SCRIPT_DIR/detach-launch.js" "$LOG" \
        node "$SCRIPT_DIR/supervise-server.js" "$LOG" frontend "$WORKTREE_SLUG" "$SCRIPT_DIR" \
          "$NODE_BIN" node_modules/vite/bin/vite.js > /dev/null 2>&1 )

  for _ in $(seq 1 40); do
    curl -sf -o /dev/null --max-time 3 "http://localhost:${FRONTEND_PORT}/" && break
    sleep 1
  done
  if ! curl -sf -o /dev/null --max-time 3 "http://localhost:${FRONTEND_PORT}/"; then
    echo "  attempt $i: FRONTEND FAILED TO START under $NODE_BIN -- aborting"; tail -5 "$LOG"; exit 1
  fi

  before=$(wc -c < "$LOG")
  bash scripts/e2e.sh > ".dev-logs/ab-$LABEL-$i.out" 2>&1
  if tail -c +"$before" "$LOG" | grep -q "0xC0000409"; then
    crashes=$((crashes + 1))
    echo "  attempt $i: CRASH 0xC0000409"
  else
    echo "  attempt $i: clean ($(grep -cE '^  ok' ".dev-logs/ab-$LABEL-$i.out" 2>/dev/null) ok)"
  fi
done
echo "== $LABEL result: $crashes crash(es) in $ATTEMPTS attempts =="
