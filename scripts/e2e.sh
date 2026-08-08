#!/usr/bin/env bash
# Runs the Playwright e2e suite against THIS worktree's own isolated local stack, so e2e runs
# from different worktrees never collide (each has its own ports/database -- see
# scripts/worktree-env.sh). Brings that stack up first if it isn't already running.
#
# Reuses that stack if it's already serving; otherwise starts it and WAITS for it to be ready
# (up.sh is readiness-gated) rather than racing a backend that isn't listening yet.
#
# Usage: bash scripts/e2e.sh [--restart] [-- <extra playwright args>]
#   bash scripts/e2e.sh                       # full suite, reusing a healthy stack
#   bash scripts/e2e.sh --restart             # force a fresh stack (needed after backend changes)
#   bash scripts/e2e.sh -- --grep "@smoke"     # pass args straight through to `playwright test`
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$SCRIPT_DIR/worktree-env.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/worktree-env.sh"
  # Reuse a stack that's already serving rather than bouncing it -- the same idea as Playwright's
  # own `webServer.reuseExistingServer`. Saves ~30s per run.
  #
  # This is only safe because worktree-env.sh now guarantees these ports belong to THIS worktree
  # alone. Before that fix three worktrees shared 8081/3001, and "something healthy is already on
  # my ports" could mean a concurrent session's stack -- reusing it would have run the suite
  # against someone else's frontend. If that check is ever weakened, this reuse must go with it.
  #
  # Vite hot-reloads, so frontend edits are picked up by a reused stack. The BACKEND does not --
  # `mvn spring-boot:run` has no hot-reload, so a reused backend still serves the code it booted
  # with. Pass --restart (or set E2E_RESTART=1) after changing backend code.
  if [ "${1:-}" = "--restart" ]; then
    E2E_RESTART=1
    shift
  fi
  if [ "${E2E_RESTART:-0}" != "1" ] \
     && curl -sf -o /dev/null --max-time 5 "http://localhost:$BACKEND_PORT/actuator/health" \
     && curl -sf -o /dev/null --max-time 5 "http://localhost:$FRONTEND_PORT"; then
    echo "Reusing the stack already running for worktree '$WORKTREE_SLUG'" \
         "(backend :$BACKEND_PORT, frontend :$FRONTEND_PORT)."
    echo "NOTE: the backend does not hot-reload -- re-run with --restart after backend changes."
  else
    "$SCRIPT_DIR/up.sh"
  fi
else
  # Isolated per-worktree stacks aren't wired up yet in this checkout -- fall back to the
  # historical fixed-port flow (assumes you've already started the backend/frontend yourself,
  # e.g. via `/run-local`, matching .claude/commands/deploy-to-lower.md's e2e section).
  echo "scripts/worktree-env.sh not found -- assuming the app is already running on the" >&2
  echo "historical fixed ports (backend :8080, frontend :3000). Start it first if it isn't." >&2
  FRONTEND_PORT="${FRONTEND_PORT:-3000}"
fi

: "${E2E_TEST_SUPPORT_KEY:?E2E_TEST_SUPPORT_KEY must be set (see application-local.yml test-support-key)}"

cd "$REPO_ROOT/e2e"
[ -d node_modules ] || npm install

E2E_BASE_URL="http://localhost:${FRONTEND_PORT}" npx playwright test "$@"
