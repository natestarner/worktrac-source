#!/usr/bin/env bash
# Records WHY a dev server just died -- to two places at once.
#
#   1. stdout, which up.sh redirects into that worktree's own .dev-logs/<name>.log, right under the
#      `[[<name> exited rc=N]]` marker.
#   2. a SHARED, CROSS-WORKTREE ledger, so the history survives in one place.
#
# Why (2) exists. Each worktree keeps its own .dev-logs/ by design -- that isolation is what stops
# concurrent sessions clobbering each other. But it means a death is recorded only in the worktree
# it happened in, and worktrees get retired (scripts/worktree-cleanup.sh) taking their logs with
# them. So the one question that actually matters -- "this keeps happening, what do the occurrences
# have in common?" -- was unanswerable: the evidence was scattered across directories, some of
# which no longer existed. The ledger lives in the SHARED git dir (`git rev-parse --git-common-dir`,
# identical from every worktree and from the primary checkout), so every worktree appends to the
# same file, and removing a worktree never takes its history with it. It is inside .git, so it is
# never committed and never needs a gitignore entry.
#
# WHY COMMIT CHARGE AND NOT FREE RAM.
# up.sh has recorded the exit code since 2026-08-09, and that told us the frontend exits with 127.
# What it never captured was the machine's state at that moment, so "why 127" stayed open for
# months. Measured 2026-08-16: a full suite at 11 workers drove Windows COMMIT CHARGE to 98.8% of a
# 49.59 GB limit (31.5 GB physical + an 18.5 GB auto-managed pagefile) while free physical RAM still
# read 4.3 GB. That divergence is exactly why an earlier investigation recorded "7+ GB free
# throughout" and struck OOM off the list: free RAM is the wrong instrument -- it stays comfortable
# while commit, the number that gates every allocation and every process spawn, runs out.
# So: capture commit, capture free RAM beside it to keep the divergence visible, and capture process
# counts (a burst of 47 chrome-headless-shell processes is what moves the number).
#
# NOT `set -e`. This is diagnostics bolted to a failure path. It must never fail in a way that
# obscures the exit line it follows. Note the ordering in up.sh's _record_exit: the rc line is
# emitted by bash's `echo` BUILTIN first, so it lands even when the host is too starved to spawn
# anything -- which is the exact condition this script exists to document. If PowerShell cannot
# start here, that failure is itself a finding and is recorded as one.
set -uo pipefail

LABEL="${1:-server}"      # backend | frontend
SLUG="${2:-unknown}"      # which worktree, so the shared ledger is attributable
RC="${3:-?}"              # the exit code that just landed

# Planned or not? down.sh drops a sentinel immediately before it kills anything, so an exit that
# follows one is a deliberate stop (/run-local, /stop-local, `e2e.sh --restart`) rather than the
# failure this ledger exists for. Both are recorded -- tagging at write time and filtering at read
# time keeps the full history, where dropping planned stops outright would throw away the evidence
# that a "planned" stop was actually something else. deaths.sh hides them by default.
# Freshness-based rather than delete-on-read, because the dying wrapper runs asynchronously and a
# sentinel consumed by the first server would mislabel the second one as unexpected.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SENTINEL="$(cd "$SELF_DIR/.." && pwd)/.dev-logs/.planned-stop"
INTENT=unexpected
if [ -f "$SENTINEL" ]; then
  _now=$(date +%s)
  _then=$(stat -c %Y "$SENTINEL" 2>/dev/null || echo 0)
  [ "$((_now - _then))" -le 60 ] && INTENT=planned
fi

SNAP=$(powershell.exe -NoProfile -Command '
$m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory -ErrorAction SilentlyContinue
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
if (-not $m -or -not $os) { exit 1 }
$pct = if ($m.CommitLimit -gt 0) { [math]::Round(100 * $m.CommittedBytes / $m.CommitLimit, 1) } else { 0 }
$free = [math]::Round($os.FreePhysicalMemory / 1KB, 0)
$n = @(Get-Process -Name node -ErrorAction SilentlyContinue).Count
$c = @(Get-Process -Name chrome, chrome-headless-shell -ErrorAction SilentlyContinue).Count
$j = @(Get-Process -Name java -ErrorAction SilentlyContinue).Count
"commit={0}% ({1:N1}/{2:N1} GB)  free_ram={3} MB  node={4}  chrome={5}  java={6}" -f `
  $pct, ($m.CommittedBytes / 1GB), ($m.CommitLimit / 1GB), $free, $n, $c, $j
' 2>/dev/null)

if [ -z "$SNAP" ]; then
  # Worth its own line rather than silence: under severe commit pressure, failing to start
  # PowerShell is itself strong evidence for the very condition being investigated.
  SNAP="UNAVAILABLE -- could not spawn PowerShell (itself a memory-pressure signal)"
fi

echo "[[$LABEL mem-at-exit]] $SNAP"

# --- shared ledger ------------------------------------------------------------------------------
# Best-effort: a death must still be recorded in the local log even if the shared path is somehow
# unavailable, so every failure here is swallowed deliberately.
LEDGER_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -n "$LEDGER_DIR" ] && [ -d "$LEDGER_DIR" ]; then
  LEDGER="$LEDGER_DIR/worktrac-server-deaths.log"
  # `>>` with a single short line is atomic enough for concurrent worktrees on Windows; this is a
  # forensic trail, not a transaction log, and interleaving would only ever cost one line.
  printf '%s  intent=%-10s worktree=%-30s server=%-8s rc=%-4s %s\n' \
    "$(date +%Y-%m-%dT%H:%M:%S)" "$INTENT" "$SLUG" "$LABEL" "$RC" "$SNAP" >> "$LEDGER" 2>/dev/null || true
fi
