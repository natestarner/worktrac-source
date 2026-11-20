#!/usr/bin/env bash
# Counts the database round trips ONE backend request sends, against THIS worktree's running local
# stack (bash scripts/up.sh first). Each sql_batch_completed / rpc_completed event in an Extended
# Events session on the local SQL Server is one client request on the wire.
#
#   bash scripts/diagnostics/db-round-trips.sh            # a no-change History sync, on Plus
#   bash scripts/diagnostics/db-round-trips.sh free       # the same on Free
#
# Background jobs (the outbox poller, ShedLock, the access-invalidation poll) are filtered out, but
# an email the registration queued can still land in the window; ignore registration_events rows.
# Findings and how to read them: docs/architecture/latency.md.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Read this checkout's port and database. Through `bash -c` from its root, because worktree-env.sh's
# wrong-checkout guard assumes the sourcing script sits directly in scripts/, not scripts/diagnostics/.
eval "$(cd "$ROOT" && bash -c 'source scripts/worktree-env.sh > /dev/null; echo "BACKEND_PORT=$BACKEND_PORT DB_NAME=$DB_NAME"')"
plan="${1:-plus}"
API="http://localhost:${BACKEND_PORT}"
KEY=$(grep -oE "test-support-key: *[^ ]+" "$ROOT/backend/src/main/resources/application-local.yml" | sed 's/.*: *//' | tr -d '"')
PASS=$(grep -m1 -E "^\s+password:" "$ROOT/backend/src/main/resources/application-local.yml" | sed 's/.*password: *//')
SQLCMD="${SQLCMD:-/c/Program Files/SqlCmd/sqlcmd.exe}"
SQL=("$SQLCMD" -S localhost,1434 -U sa -P "$PASS" -C -W -s "|" -h -1 -d master)
j() { python -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

email="round-trips-$(date +%s)@example.com"
curl -sf -o /dev/null -X POST "$API/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"password123\",\"personName\":\"Probe\"}"
code=$(curl -sf "$API/api/auth/test/pending-code?email=$email" -H "X-E2E-Test-Key: $KEY" | j "d['code']")
confirm=$(curl -sf -X POST "$API/api/auth/confirm-email" -H 'Content-Type: application/json' -d "{\"email\":\"$email\",\"code\":\"$code\"}")
token=$(echo "$confirm" | j "d['token']")
person=$(echo "$confirm" | j "d['person']['id']")
H=(-H "Authorization: Bearer $token")
[ "$plan" = "plus" ] && curl -sf -o /dev/null -X POST "$API/api/auth/test/billing-plan?email=$email&plan=PLUS" -H "X-E2E-Test-Key: $KEY"
ex=$(curl -sf "${H[@]}" "$API/api/exercises" | j "d[0]['id']")
for _ in 1 2 3; do
  curl -sf -o /dev/null "${H[@]}" -X POST "$API/api/people/$person/live-sets" -H 'Content-Type: application/json' \
    -d "{\"exerciseId\":$ex,\"weight\":100,\"reps\":5}"
done
have=$(curl -sf "${H[@]}" -X POST "$API/api/people/$person/history/sync" -H 'Content-Type: application/json' -d '{"have":{}}' \
  | j "json.dumps({'have':{m:d['changed'][m]['fp'] for m in d['months']}})")
# One warm-up so the access cache and the plan cache are as they would be on a normal app open.
curl -sf -o /dev/null "${H[@]}" -X POST "$API/api/people/$person/history/sync" -H 'Content-Type: application/json' -d "$have"

"${SQL[@]}" -Q "IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name='round_trips') DROP EVENT SESSION round_trips ON SERVER;
CREATE EVENT SESSION round_trips ON SERVER
 ADD EVENT sqlserver.rpc_completed(ACTION(sqlserver.session_id) WHERE sqlserver.database_name = N'$DB_NAME'),
 ADD EVENT sqlserver.sql_batch_completed(ACTION(sqlserver.session_id) WHERE sqlserver.database_name = N'$DB_NAME')
 ADD TARGET package0.ring_buffer WITH (MAX_DISPATCH_LATENCY = 1 SECONDS);
ALTER EVENT SESSION round_trips ON SERVER STATE = START;" > /dev/null
sleep 1
curl -s -o /dev/null -w "history sync: http %{http_code} in %{time_total}s\n" "${H[@]}" \
  -X POST "$API/api/people/$person/history/sync" -H 'Content-Type: application/json' -d "$have"
sleep 2
"${SQL[@]}" -Q "SET NOCOUNT ON;
WITH x AS (SELECT CAST(t.target_data AS XML) AS d FROM sys.dm_xe_session_targets t
           JOIN sys.dm_xe_sessions s ON s.address = t.event_session_address WHERE s.name = 'round_trips')
SELECT e.value('(action[@name=\"session_id\"]/value)[1]','int') AS session,
       e.value('(data[@name=\"duration\"]/value)[1]','bigint') AS us,
       LEFT(REPLACE(REPLACE(COALESCE(e.value('(data[@name=\"statement\"]/value)[1]','nvarchar(max)'),
                                     e.value('(data[@name=\"batch_text\"]/value)[1]','nvarchar(max)')),CHAR(10),' '),CHAR(13),' '),100)
FROM x CROSS APPLY d.nodes('/RingBufferTarget/event') n(e)
ORDER BY e.value('@timestamp','datetime2');
ALTER EVENT SESSION round_trips ON SERVER STATE = STOP; DROP EVENT SESSION round_trips ON SERVER;" \
  | grep -v -i "access_invalidations\|FROM outbox\|UPDATE outbox\|shedlock" | grep . | nl
