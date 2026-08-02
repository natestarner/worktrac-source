#!/usr/bin/env bash
# Runs the Playwright e2e suite against THIS worktree's own isolated local stack, so e2e runs
# from different worktrees never collide (each has its own ports/database -- see
# scripts/worktree-env.sh). Brings that stack up first if it isn't already running.
#
# Usage: bash scripts/e2e.sh [-- <extra playwright args>]
#   bash scripts/e2e.sh                       # full suite
#   bash scripts/e2e.sh -- --grep "@smoke"     # pass args straight through to `playwright test`
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$SCRIPT_DIR/worktree-env.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/worktree-env.sh"
  "$SCRIPT_DIR/up.sh"
else
  # Isolated per-worktree stacks aren't wired up yet in this checkout -- fall back to the
  # historical fixed-port flow (assumes you've already started the backend/frontend yourself,
  # e.g. via `/run-local`, matching .claude/commands/deploy-to-lower.md's e2e section).
  echo "scripts/worktree-env.sh not found -- assuming the app is already running on the" >&2
  echo "historical fixed ports (backend :8080, frontend :3000). Start it first if it isn't." >&2
  FRONTEND_PORT="${FRONTEND_PORT:-3000}"
fi

: "${E2E_TEST_SUPPORT_KEY:?E2E_TEST_SUPPORT_KEY must be set (see application-local.yml's test-support-key)}"

cd "$REPO_ROOT/e2e"
[ -d node_modules ] || npm install

E2E_BASE_URL="http://localhost:${FRONTEND_PORT}" npx playwright test "$@"
