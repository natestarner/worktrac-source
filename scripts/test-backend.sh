#!/usr/bin/env bash
# Backend test tiers. Every integration test class (Spring context + database) extends
# AbstractIntegrationTest and is tagged "integration" -- this is what lets the fast unit tier
# below skip all 24 of them (no container, no database, no Spring context) via Surefire's
# built-in -DexcludedGroups support, with zero extra pom.xml config needed.
#
# Usage:
#   bash scripts/test-backend.sh unit   # ~10s -- no container, no DB, no Spring context
#   bash scripts/test-backend.sh        # full mvn verify (default) -- singleton container,
#                                       # per-class database, class-level parallelism
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT/backend"

if [ "${1:-}" = "unit" ]; then
  mvn test -DexcludedGroups=integration
else
  mvn verify
fi
