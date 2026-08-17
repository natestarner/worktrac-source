#!/usr/bin/env bash
# Every dev-server death this machine has recorded, across ALL worktrees, with the memory state at
# each one -- and a verdict on whether memory explains it.
#
# This answers the question that per-worktree logs structurally could not: "it keeps dying, what do
# the occurrences have in common?" Each worktree keeps its own .dev-logs/ (isolation that stops
# concurrent sessions clobbering each other), so evidence was scattered across directories -- and
# retiring a worktree via scripts/worktree-cleanup.sh deleted its share of the history outright.
# up.sh now also appends every death to one shared ledger in the common git dir; this reads it.
#
# Usage: bash scripts/deaths.sh [N]      # N = how many recent entries to show (default 20)
set -uo pipefail

LIMIT="${1:-20}"

LEDGER_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -z "$LEDGER_DIR" ]; then
  echo "Not inside the worktrac repository (no shared git dir found)." >&2
  exit 1
fi
LEDGER="$LEDGER_DIR/worktrac-server-deaths.log"

echo "Ledger: $LEDGER"
echo ""

if [ ! -s "$LEDGER" ]; then
  echo "No exits recorded yet."
  echo ""
  echo "That is a real result, not a gap: up.sh records EVERY server exit here, including the"
  echo "ordinary ones caused by down.sh. An empty ledger means no server has stopped since it was"
  echo "introduced -- if you expected entries, check the stack has been restarted at least once"
  echo "via scripts/up.sh since then."
  exit 0
fi

total=$(wc -l < "$LEDGER" | tr -d ' ')
echo "== $total recorded exit(s); showing the most recent $LIMIT =="
echo ""
tail -n "$LIMIT" "$LEDGER"

echo ""
echo "== Does memory explain them? =="
# The threshold is deliberate. Measured 2026-08-16, a full suite at 11 workers peaked at 98.8%
# commit while free physical RAM still read 4.3 GB -- so anything in the mid-90s is already in the
# range where an allocation or a process spawn can fail, which is what an rc=127 death looks like.
# free_ram is printed alongside precisely because it does NOT move: a comfortable free_ram next to a
# 97% commit is the whole point, and is why OOM was wrongly ruled out for months.
awk '
  {
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^commit=/) {
        c = $i; sub(/^commit=/, "", c); sub(/%$/, "", c)
        n++
        if (c + 0 >= 95) high++
        if (c + 0 > max) max = c + 0
      }
    }
  }
  END {
    if (n == 0) {
      print "  (no commit readings captured -- snapshots may have failed to spawn)"
      exit
    }
    printf "  peak commit seen : %.1f%%\n", max
    printf "  exits at >=95%%   : %d of %d\n", high + 0, n
    print ""
    if (high + 0 > 0) {
      print "  >=95% means the host was at its commit ceiling. That is the leading explanation for"
      print "  an rc=127 exit: a failed allocation or process spawn, not a crash in Vite or the app."
    } else {
      print "  Commit was comfortable at every recorded exit, so memory does NOT explain these."
      print "  Read the lines above the marker in that worktree'\''s .dev-logs/<server>.log instead."
    }
  }
' "$LEDGER"
