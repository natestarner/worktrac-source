#!/usr/bin/env bash
# Drops and recreates THIS worktree's own database only -- never touches any other
# worktree's database on the shared server. Flyway re-migrates it from scratch the next
# time the backend starts.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-env.sh"

SA_PASSWORD="LocalDev123!"
SQLCMD=(env MSYS_NO_PATHCONV=1 docker exec worktrac-sqlserver /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$SA_PASSWORD")

echo "Dropping and recreating [$DB_NAME] (worktree '$WORKTREE_SLUG') -- other worktrees' databases are untouched."
"${SQLCMD[@]}" -Q "
IF DB_ID(N'$DB_NAME') IS NOT NULL
BEGIN
    ALTER DATABASE [$DB_NAME] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [$DB_NAME];
END
CREATE DATABASE [$DB_NAME];
-- Recreate it the way db.sh would, so a reset database is not quietly less
-- concurrency-safe than one db.sh made. See db.sh for why this must match Azure SQL.
ALTER DATABASE [$DB_NAME] SET READ_COMMITTED_SNAPSHOT ON;
"
echo "Done. [$DB_NAME] will be re-migrated by Flyway the next time the backend starts."
