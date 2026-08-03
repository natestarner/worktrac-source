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
