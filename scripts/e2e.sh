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
    # Starting the stack from inside this script means up.sh and the long test run share one
    # shell invocation -- the single surviving correlation for the Vite dev server dying
    # mid-suite (see the KNOWN UNRESOLVED block in up.sh). Reusing an already-running stack
    # avoids it entirely, so say so rather than letting a full suite silently take the risky
    # path. This is advice, not a hard failure: a one-shot run usually completes fine.
    echo "" >&2
    echo "NOTE: this run STARTED the stack, so up.sh and the suite share one shell invocation --" >&2
    echo "  the condition under which the Vite dev server has been seen to die mid-suite. For a" >&2
    echo "  full-suite run, prefer two separate invocations:" >&2
    echo "     bash scripts/up.sh      # then, separately:" >&2
    echo "     bash scripts/e2e.sh     # reuses the healthy stack" >&2
    echo "" >&2
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

# The documented usage is `e2e.sh [--restart] [-- <playwright args>]`, but the `--` separator was
# being forwarded verbatim to `playwright test`, which treats it as a positional filter that
# matches nothing -- so `e2e.sh -- tests/smoke.spec.ts` silently ran the ENTIRE suite instead of
# the one file, and looked like it had simply ignored the argument. Drop the separator here.
[ "${1:-}" = "--" ] && shift

cd "$REPO_ROOT/e2e"
[ -d node_modules ] || npm install

# `|| rc=$?` so a normal test failure doesn't skip the stack check below -- that check is most
# valuable precisely when the run failed.
rc=0
E2E_BASE_URL="http://localhost:${FRONTEND_PORT}" npx playwright test "$@" || rc=$?

# Did the stack outlive the run? A dev server dying mid-suite shows up as scattered failures across
# unrelated specs -- `smoke.spec.ts` among them -- which reads exactly like a code regression and
# has cost real time being chased as one. Say it plainly instead, and point at the exit line up.sh
# records so the next question ("did it exit or was it killed?") is already answered.
if [ -n "${BACKEND_PORT:-}" ]; then
  for pair in "backend:$BACKEND_PORT:/actuator/health" "frontend:$FRONTEND_PORT:/"; do
    name="${pair%%:*}"; rest="${pair#*:}"; port="${rest%%:*}"; path="${rest#*:}"
    if ! curl -sf -o /dev/null --max-time 5 "http://localhost:${port}${path}"; then
      echo "" >&2
      echo "⚠️  The $name died during this run (:$port no longer answers)." >&2
      echo "   Test results above are NOT trustworthy -- specs after it went down failed for that" >&2
      echo "   reason, not because of your change. Check $REPO_ROOT/.dev-logs/$name.log:" >&2
      echo "     an '[[$name exited rc=...]]' line means it exited on its own (rc says why);" >&2
      echo "     no such line means something killed it (a sibling worktree's down.sh is the" >&2
      echo "     usual suspect -- see .claude/rules/e2e-tests.md)." >&2
      # Scoped to the CURRENT server session only. up.sh appends to these logs now (it used to
      # truncate, which erased this very marker before anyone could read it -- see up.sh's
      # _open_log), so an unscoped grep would also surface markers from previous starts and
      # report a death that already happened days ago as if it were this run's.
      # awk, not `sed -n '/started/,$p'`: that prints from the FIRST banner to the end, which with
      # several starts in one file is the whole history again. Resetting a buffer at every banner
      # leaves exactly the LAST session in it.
      awk -v n="$name" '
        $0 ~ ("\\[\\[" n " started at ") { buf = "" }
        { buf = buf $0 ORS }
        END { printf "%s", buf }
      ' "$REPO_ROOT/.dev-logs/$name.log" 2>/dev/null | grep -a "\[\[$name exited" >&2 || true
      echo "   Re-run after 'bash scripts/up.sh' in a SEPARATE invocation before believing any" >&2
      echo "   of the failures above." >&2
      rc=1
    fi
  done
fi

exit "$rc"
