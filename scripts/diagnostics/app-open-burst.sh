#!/usr/bin/env bash
# Replays the burst of requests one app open sends (~25 at once, taken from lower's per-request
# log) against the backend running in Docker under a CPU cap, with the database on this machine so
# that no network distance is involved. Shows how much of a request's time is waiting for CPU.
#
#   bash scripts/diagnostics/app-open-burst.sh 0.5 1 4     # one run per CPU cap
#
# Needs: the shared worktrac-sqlserver container up, a built jar
# (cd backend && mvn -q package -DskipTests), and a local image with a Java 25 runtime
# (BURST_IMAGE, default eclipse-temurin:25-jre-alpine). BURST_JAR overrides the jar path. Uses the main `worktrac` database and
# host port 18080. Findings and how to read them: docs/architecture/latency.md.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${BURST_IMAGE:-eclipse-temurin:25-jre-alpine}"
API=http://localhost:18080
JAR="${BURST_JAR:-$(ls "$ROOT"/backend/target/backend-*.jar 2>/dev/null | head -1)}"
KEY=$(grep -oE "test-support-key: *[^ ]+" "$ROOT/backend/src/main/resources/application-local.yml" | sed 's/.*: *//' | tr -d '"')
OUT=$(mktemp -d)
j() { python -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

start_backend() {
  docker rm -f app-open-burst > /dev/null 2>&1 || true
  MSYS_NO_PATHCONV=1 docker run -d --name app-open-burst --cpus "$1" --memory 1g -p 18080:8080 \
    -v "$JAR:/run.jar:ro" --entrypoint java \
    -e SPRING_PROFILES_ACTIVE=local \
    -e SPRING_DATASOURCE_URL="jdbc:sqlserver://host.docker.internal:1434;database=worktrac;encrypt=false;trustServerCertificate=true" \
    -e SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE=10 \
    -e ACS_EMAIL_CONNECTION_STRING -e ACS_EMAIL_SENDER_ADDRESS \
    "$IMAGE" -XX:+ExitOnOutOfMemoryError -jar /run.jar > /dev/null
  for _ in $(seq 1 120); do
    curl -s -o /dev/null -w "%{http_code}" "$API/actuator/health/liveness" 2>/dev/null | grep -q 200 && return
    sleep 2
  done
  echo "backend did not start at $1 CPUs" >&2; exit 1
}

seed() { # a Plus household with three people, each with a workout and a synced History
  local email="burst-$(date +%s%N)@example.com"
  curl -sf -o /dev/null -X POST "$API/api/auth/register" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"password123\",\"personName\":\"Nate\"}"
  local code; code=$(curl -sf "$API/api/auth/test/pending-code?email=$email" -H "X-E2E-Test-Key: $KEY" | j "d['code']")
  local confirm; confirm=$(curl -sf -X POST "$API/api/auth/confirm-email" -H 'Content-Type: application/json' -d "{\"email\":\"$email\",\"code\":\"$code\"}")
  TOKEN=$(echo "$confirm" | j "d['token']")
  PEOPLE=("$(echo "$confirm" | j "d['person']['id']")")
  curl -sf -o /dev/null -X POST "$API/api/auth/test/billing-plan?email=$email&plan=PLUS" -H "X-E2E-Test-Key: $KEY"
  H=(-H "Authorization: Bearer $TOKEN")
  for name in Sam Max; do
    PEOPLE+=("$(curl -sf "${H[@]}" -X POST "$API/api/people" -H 'Content-Type: application/json' -d "{\"name\":\"$name\"}" | j "d['id']")")
  done
  local ex; ex=$(curl -sf "${H[@]}" "$API/api/exercises" | j "d[0]['id']")
  declare -gA HAVE
  for p in "${PEOPLE[@]}"; do
    for _ in 1 2 3 4; do
      curl -sf -o /dev/null "${H[@]}" -X POST "$API/api/people/$p/live-sets" -H 'Content-Type: application/json' \
        -d "{\"exerciseId\":$ex,\"weight\":100,\"reps\":5}"
    done
    HAVE[$p]=$(curl -sf "${H[@]}" -X POST "$API/api/people/$p/history/sync" -H 'Content-Type: application/json' -d '{"have":{}}' \
      | j "json.dumps({'have':{m:d['changed'][m]['fp'] for m in d['months']}})")
  done
}

req() { # one timed request into its own file (parallel writers must not share one)
  local dir=$1 name=$2; shift 2
  curl -s -o /dev/null -w "$name %{http_code} %{time_total}\n" "${H[@]}" "$@" > "$dir/$name.$RANDOM$RANDOM$RANDOM"
}

burst() {
  local dir=$1 s; s=$(date +%s%N)
  req "$dir" me "$API/api/auth/me" &
  req "$dir" roster "$API/api/account/roster" &
  req "$dir" exercises "$API/api/exercises" &
  req "$dir" tags "$API/api/tags" &
  for p in "${PEOPLE[@]}"; do
    req "$dir" live "$API/api/people/$p/sessions/live" &
    req "$dir" window "$API/api/people/$p/history-window" &
    req "$dir" routines "$API/api/people/$p/routines" &
    req "$dir" picker "$API/api/people/$p/exercises" &
    req "$dir" sync -X POST "$API/api/people/$p/history/sync" -H 'Content-Type: application/json' -d "${HAVE[$p]}" &
  done
  wait
  echo "whole_burst 200 $(python -c "print(($(date +%s%N)-$s)/1e9)")" > "$dir/wall.$RANDOM$RANDOM"
}

for cpus in "${@:-0.5 1 4}"; do
  start_backend "$cpus"
  seed
  dir="$OUT/$cpus"; mkdir -p "$dir"
  for _ in 1 2 3 4 5 6; do
    burst "$dir"; sleep 3
    req "$dir" sync_alone -X POST "$API/api/people/${PEOPLE[0]}/history/sync" -H 'Content-Type: application/json' -d "${HAVE[${PEOPLE[0]}]}"
    sleep 3
  done
  cat "$dir"/* | python -c "
import sys, statistics, collections
rows = collections.defaultdict(list); bad = 0
for line in sys.stdin:
    if not line.strip(): continue
    name, status, t = line.split()
    bad += not status.startswith('2')
    rows[name].append(float(t) * 1000)
print('== %s CPUs  (non-2xx: %d)' % ('$cpus', bad))
for name in ['whole_burst', 'me', 'roster', 'exercises', 'tags', 'live', 'window', 'routines', 'picker', 'sync', 'sync_alone']:
    v = sorted(rows[name])
    if v: print('  %-12s n=%3d  p50=%6.0f ms  max=%6.0f ms' % (name, len(v), statistics.median(v), v[-1]))
"
done
docker rm -f app-open-burst > /dev/null
rm -rf "$OUT"
