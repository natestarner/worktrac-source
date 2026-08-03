#!/usr/bin/env bash
# Sanity-checks this machine/worktree before spinning up a stack. Every check is
# best-effort/non-fatal -- this is a diagnostic, not a gate.
set +e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-env.sh"

echo "== Doctor: worktree '$WORKTREE_SLUG' =="

for tool in docker mvn node npm; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "[ok]   $tool ($($tool --version 2>&1 | head -1))"
  else
    echo "[FAIL] $tool not found on PATH"
  fi
done

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx worktrac-sqlserver; then
  echo "[ok]   worktrac-sqlserver container running"
else
  echo "[warn] worktrac-sqlserver not running -- scripts/db.sh will start/create it"
fi

# fs.aio-max-nr headroom matters once backend test class parallelism is running multiple
# Testcontainers-backed JVM forks concurrently (see junit-platform.properties) -- only
# meaningful inside the Docker Desktop WSL2 VM, so this is best-effort/informational.
if command -v wsl.exe >/dev/null 2>&1; then
  AIO_MAX="$(wsl.exe -d docker-desktop -- cat /proc/sys/fs/aio-max-nr 2>/dev/null)"
  if [ -n "$AIO_MAX" ]; then
    echo "[info] fs.aio-max-nr in Docker Desktop WSL2 VM: $AIO_MAX"
    if [ "$AIO_MAX" -lt 1048576 ] 2>/dev/null; then
      echo "[warn] fs.aio-max-nr looks low ($AIO_MAX) -- see docs/DEVELOPMENT.md for how to raise it"
    fi
  fi
fi

echo ""
echo "Ports for this worktree: backend :$BACKEND_PORT, frontend :$FRONTEND_PORT"
if netstat -ano | grep -qE ":(${BACKEND_PORT}|${FRONTEND_PORT})[[:space:]].*LISTENING"; then
  echo "[info] something is already listening on the above -- scripts/up.sh frees this worktree's own ports before starting"
else
  echo "[ok]   ports free"
fi
