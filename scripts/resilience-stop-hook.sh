#!/usr/bin/env bash
# Claude Code `Stop` hook wrapper around scripts/check-resilience-invariants.sh.
#
# Point: catch a broken invariant while the worktree is still open and the context is still loaded,
# instead of at PR time. CI runs the same script, so this is an early warning, never the only gate.
#
# Two deliberate behaviours:
#
#  1. It only ever blocks ONCE. Claude Code re-invokes the model when a Stop hook exits 2, then
#     sets `stop_hook_active: true` on that follow-up turn. Honouring that flag is what keeps a
#     legitimately-failing check (mid-refactor, say) from becoming an infinite stop/resume loop.
#  2. It never blocks on its own breakage. If the guard script is missing or unrunnable, that is a
#     tooling problem, not a contract violation -- exit 0 and stay out of the way. The guard itself
#     fails closed on a rotted assumption; this wrapper must not turn that into a wedged session.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
GUARD="$ROOT/scripts/check-resilience-invariants.sh"

# The hook payload arrives as JSON on stdin. Read it without needing jq (not present in stock
# Git-for-Windows bash, which is what this repo's tooling already has to assume -- see up.sh's
# setsid fallback).
PAYLOAD=$(cat 2>/dev/null || true)
case "$PAYLOAD" in
  *'"stop_hook_active"'*'true'*) exit 0 ;;
esac

[ -f "$GUARD" ] || exit 0

if OUTPUT=$(bash "$GUARD" 2>&1); then
  exit 0
fi

{
  echo "The degraded-conditions contract check failed for changes in this session:"
  echo ""
  echo "$OUTPUT"
  echo ""
  echo "Fix the violation, or -- if the divergence is deliberate -- add it to the register in"
  echo ".claude/rules/resilience.md and adjust the pinned count in the guard script, with a"
  echo "comment saying why. Do not silence the check without recording the reason."
} >&2

exit 2
