#!/usr/bin/env bash
# Stops the `stripe listen` process, but ONLY if THIS worktree currently owns it.
#
# Ownership is tracked in one file shared by every worktree of this repo (the git common dir --
# see stripe-listen.sh's header for why only one listener may ever run at a time). A worktree's
# /stop-local must never kill a DIFFERENT worktree's active listener out from under it just
# because this worktree happens to be shutting down -- that would be the same cross-worktree
# surprise this whole mechanism exists to prevent, just in the teardown direction instead of the
# webhook-delivery direction.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-env.sh"

LEDGER_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -z "$LEDGER_DIR" ]; then
  echo "Not inside the worktrac repository -- nothing to stop."
  exit 0
fi
STATE_FILE="$LEDGER_DIR/worktrac-stripe-listen.state"

if [ ! -f "$STATE_FILE" ]; then
  echo "No stripe listener recorded as running -- nothing to stop."
  exit 0
fi

OWNER_PID="$(sed -nE 's/^PID=(.*)$/\1/p' "$STATE_FILE")"
OWNER_WORKTREE="$(sed -nE 's/^WORKTREE=(.*)$/\1/p' "$STATE_FILE")"

if [ "$OWNER_WORKTREE" != "$WORKTREE_SLUG" ]; then
  echo "Stripe listener currently belongs to worktree '$OWNER_WORKTREE', not this one -- leaving it running."
  exit 0
fi

if [ -z "$OWNER_PID" ]; then
  echo "Stripe listener state file was malformed -- clearing it without attempting a kill."
  rm -f "$STATE_FILE"
  exit 0
fi

echo "Stopping stripe listen (PID $OWNER_PID, this worktree's own)"
powershell.exe -NoProfile -Command "Stop-Process -Id $OWNER_PID -Force" 2>/dev/null || true
rm -f "$STATE_FILE"
