#!/usr/bin/env bash
# Starts `stripe listen` forwarding Stripe webhook events to THIS worktree's own backend port, so
# testing a real checkout locally doesn't need a second terminal run by hand. `stripe listen`
# mints a webhook signing secret on start (unlike the fixed one the Dashboard gives
# lower/production -- see docs/architecture/billing.md), so this has to run and its secret has to
# be captured BEFORE the backend boots each time; the backend only reads STRIPE_WEBHOOK_SECRET
# once, at startup.
#
# ONLY ONE MAY RUN AT A TIME, MACHINE-WIDE -- this is the important part, not a nicety.
# `stripe listen` opens a connection to Stripe and receives EVERY event on the account, regardless
# of its own --forward-to target; Stripe does not partition by listener. Two worktrees each
# running their own `stripe listen` (one forwarding to :8082, the other to :8083) would each still
# receive a full copy of every event -- including one meant for the OTHER worktree's checkout.
# StripeWebhookController resolves which account an event belongs to from `metadata.accountId`, a
# small local auto-increment id with no cross-database meaning, so two separately-seeded worktree
# databases routinely share small ids (both commonly have an account #1). A cross-delivered event
# would then get applied to the WRONG worktree's unrelated account -- silent, cross-worktree data
# corruption, not a cosmetic bug. Fixing that in StripeWebhookController would mean hardening
# webhook account resolution that ships to lower/production too, for a problem that is purely a
# local-multi-worktree artifact; enforcing "only one listener, ever" here avoids the problem
# entirely without touching billing verification code at all.
#
# So this tracks ownership in ONE file shared by every worktree of this repo -- the git common dir
# (`git rev-parse --git-common-dir`, the same idiom scripts/deaths.sh already uses for a
# shared-across-worktrees ledger), not this worktree's own .dev-logs/. Starting here stops
# whichever worktree currently owns it, if any, and takes over.
#
# On success, prints exactly one line to stdout: export STRIPE_WEBHOOK_SECRET=whsec_... .
# Callers (`/run-local`) `eval` that line so it lands in the environment the backend then starts
# in -- everything else this script prints goes to stderr, so stdout is always either that one
# line or nothing.
#
# A no-op, not a failure, when the Stripe CLI isn't installed or isn't logged in -- billing already
# degrades to an honest 503 with no Stripe env configured at all (StripeProperties), so a worktree
# that doesn't care about billing must never have this block the rest of /run-local.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-env.sh"

if ! command -v stripe >/dev/null 2>&1; then
  echo "stripe-listen: Stripe CLI not found on PATH -- skipping (billing will 503 honestly)." >&2
  exit 0
fi

if ! stripe config --list >/dev/null 2>&1; then
  echo "stripe-listen: Stripe CLI isn't logged in (run 'stripe login') -- skipping." >&2
  exit 0
fi

LEDGER_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -z "$LEDGER_DIR" ]; then
  echo "stripe-listen: not inside the worktrac repository -- skipping." >&2
  exit 0
fi
STATE_FILE="$LEDGER_DIR/worktrac-stripe-listen.state"

LOG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/.dev-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/stripe-listen.log"

# Take over from whoever currently owns it -- including this same worktree re-running this script,
# which is what makes re-running /run-local safe. Stopping an already-dead PID is a harmless no-op
# (same as down.sh's own kills), so no separate liveness check is needed first.
# Extracted by grep/sed rather than `source`-ing the state file: it sets PID/WORKTREE/PORT, and
# sourcing it would clobber this script's OWN $PID the moment the new process starts below.
if [ -f "$STATE_FILE" ]; then
  PREV_PID="$(sed -nE 's/^PID=(.*)$/\1/p' "$STATE_FILE")"
  PREV_WORKTREE="$(sed -nE 's/^WORKTREE=(.*)$/\1/p' "$STATE_FILE")"
  if [ -n "$PREV_PID" ]; then
    if [ "$PREV_WORKTREE" != "$WORKTREE_SLUG" ]; then
      echo "stripe-listen: taking over from worktree '${PREV_WORKTREE:-unknown}' (only one listener may run at a time -- see this script's header)." >&2
    fi
    powershell.exe -NoProfile -Command "Stop-Process -Id $PREV_PID -Force" 2>/dev/null || true
  fi
fi
rm -f "$STATE_FILE"

{
  echo ""
  echo "=============================================================================="
  echo "[[stripe-listen.log started at $(date '+%Y-%m-%d %H:%M:%S') -- worktree '$WORKTREE_SLUG']]"
  echo "=============================================================================="
} >> "$LOG_FILE"

# Launched through detach-launch.js, same as the frontend and for the same reason (see its own
# header): a bare background `&`/`nohup` here would leave `stripe listen` inside this shell's
# console and it would die with the console, silently, the exact bug that used to kill Vite.
PID=$(node "$SCRIPT_DIR/detach-launch.js" "$LOG_FILE" stripe listen --forward-to "localhost:$BACKEND_PORT/api/webhooks/stripe")

SECRET=""
for _ in $(seq 1 20); do
  SECRET="$(grep -oE 'whsec_[A-Za-z0-9]+' "$LOG_FILE" | tail -1 || true)"
  [ -n "$SECRET" ] && break
  sleep 1
done

if [ -z "$SECRET" ]; then
  echo "stripe-listen: no webhook secret appeared within 20s -- check $LOG_FILE" >&2
  powershell.exe -NoProfile -Command "Stop-Process -Id $PID -Force" 2>/dev/null || true
  exit 1
fi

{
  echo "PID=$PID"
  echo "WORKTREE=$WORKTREE_SLUG"
  echo "PORT=$BACKEND_PORT"
} > "$STATE_FILE"

echo "stripe-listen: forwarding to localhost:$BACKEND_PORT/api/webhooks/stripe (PID $PID)" >&2
echo "export STRIPE_WEBHOOK_SECRET=$SECRET"
