#!/usr/bin/env bash
# Waits for a deployed backend and frontend to answer 200, then sends a short burst of health
# pings so any autoscale decision lower makes from the first request settles BEFORE the suite
# starts, not partway through its first specs (the same reasoning as worktrac-deploy's warm-up
# step: TestCodeCache is in-memory per instance, so a mid-suite scale-out caused "pending code not
# found" flakes). Used by lower-e2e-nightly.yml.
#
#   bash scripts/wait-for-lower.sh <backend health url> <frontend url>
set -euo pipefail
backend="$1"
frontend="$2"

wait_for() {
  local url="$1" label="$2" deadline=$(( $(date +%s) + 180 ))
  while true; do
    status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo "000")
    [ "$status" = "200" ] && { echo "$label is healthy."; return 0; }
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "::error::$label did not answer 200 within 180s (last status: $status)."
      return 1
    fi
    echo "  $label not ready (status $status) -- retrying in 5s..."
    sleep 5
  done
}

wait_for "$backend" Backend
wait_for "$frontend" Frontend
for i in $(seq 1 8); do
  echo "warm-up ping $i: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$backend" || echo 000)"
  sleep 2
done
