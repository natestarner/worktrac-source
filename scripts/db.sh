#!/usr/bin/env bash
# Ensures the ONE shared SQL Server container is up, then ensures THIS worktree's own
# database exists on it. Every worktree shares the same server process -- only the database
# differs -- so this never spins up a second container (see compose.yaml's header comment
# for why that matters).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-env.sh"

SA_PASSWORD="LocalDev123!"
# MSYS_NO_PATHCONV: this container's Microsoft ODBC 18 tools live at a POSIX-looking path
# that Git Bash on Windows otherwise auto-converts to a Windows path before it ever reaches
# `docker exec` (the same class of mangling documented for taskkill in run-local.md). `-C`
# trusts the container's self-signed cert -- required by ODBC 18 (mssql-tools18), unlike the
# older mssql-tools package's sqlcmd.
SQLCMD=(env MSYS_NO_PATHCONV=1 docker exec worktrac-sqlserver /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$SA_PASSWORD")

if docker ps -a --format '{{.Names}}' | grep -qx worktrac-sqlserver; then
  # Pre-existing container (created manually before compose.yaml existed, or by an earlier
  # session) -- reuse it as-is. Never hand this to `docker compose up`, which would try to
  # adopt/recreate a container it doesn't recognize as its own and risk the data inside it.
  docker ps --format '{{.Names}}' | grep -qx worktrac-sqlserver || docker start worktrac-sqlserver
else
  echo "No worktrac-sqlserver container found -- creating one via compose.yaml..."
  (cd "$REPO_ROOT" && docker compose up -d sqlserver)
fi

echo "Waiting for SQL Server (worktrac-sqlserver) to accept connections..."
for _ in $(seq 1 60); do
  if "${SQLCMD[@]}" -Q "SELECT 1" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Ensuring database [$DB_NAME] exists (worktree '$WORKTREE_SLUG')..."
"${SQLCMD[@]}" -Q "
IF DB_ID(N'$DB_NAME') IS NULL
BEGIN
    PRINT 'Creating database $DB_NAME';
    EXEC('CREATE DATABASE [$DB_NAME]');
END
"

# READ_COMMITTED_SNAPSHOT: local must match Azure SQL, not stock SQL Server.
#
# Azure SQL Database (what lower and production run) has RCSI ON by default; a SQL Server
# container has it OFF. That is not a cosmetic difference -- it changes what READ COMMITTED
# does. With RCSI off, plain reads take shared locks, so a transaction that reads and writes
# the same table interleaves S and X locks and two concurrent ones can deadlock. logLiveSet
# does exactly that: getBestComparableLb (SELECT over IX_workout_sets_person_id_exercise_id),
# then the INSERT (X locks on the clustered index AND every non-clustered index), then
# getBest (the same SELECT again) -- all in one transaction. Two people logging sets at the
# same moment is the app's normal case, not an edge case.
#
# Observed, not theorised: a full e2e suite at 11 workers produced
#   CannotAcquireLockException ... "Transaction (Process ID 94) was deadlocked on lock
#   resources and has been chosen as the deadlock victim"
# from StatsService.getBest <- WorkoutSetService.insertSetAndDetectPr. The write survives
# (a 500 is transient to shouldRetryWrite, so the durable outbox retries it), but the retry
# costs a round trip and the failure is invisible on lower/production, where RCSI is already
# on -- i.e. local was LESS concurrency-safe than the environment it is meant to mirror, and
# the local e2e suite paid for it in flakiness that no deployed run would ever reproduce.
#
# Guarded on the current setting so re-running this is a genuine no-op: ROLLBACK IMMEDIATE
# would otherwise kick the connections of a backend already running against this database.
echo "Ensuring READ_COMMITTED_SNAPSHOT is ON for [$DB_NAME] (matches Azure SQL)..."
"${SQLCMD[@]}" -Q "
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'$DB_NAME' AND is_read_committed_snapshot_on = 0)
BEGIN
    PRINT 'Enabling READ_COMMITTED_SNAPSHOT on $DB_NAME';
    EXEC('ALTER DATABASE [$DB_NAME] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE');
END
"
