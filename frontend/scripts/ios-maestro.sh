#!/usr/bin/env bash
# Runs Maestro flows against the unsigned simulator build on the newest iPhone simulator, on a GitHub
# macOS runner (mobile-ci.yml). Unlike ios-simulator-smoke.sh, which only screenshots, this READS the
# screen: Maestro sees the WebView's content through iOS accessibility, so a flow can fail on "the
# login screen never appeared" -- which the console cannot tell us (the app logs nothing on a
# healthy boot).
#
# Flows read MAESTRO_* environment variables as ${MAESTRO_...}; nothing is passed on the command line.
#
# Usage: bash scripts/ios-maestro.sh <path/to/App.app> <out-dir> <flow file or dir>...
set -euo pipefail

APP="$1"
OUT="$2"
shift 2
mkdir -p "$OUT"

source "$(dirname "$0")/ios-simulator-lib.sh"

UDID=$(pick iPhone)
echo "== iPhone: $UDID"
# Already booted when ios-simulator-smoke.sh ran first and didn't shut it down; not an error.
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl ui "$UDID" appearance light
xcrun simctl install "$UDID" "$APP"

# Maestro drives iOS through an XCTest runner it installs on first use, and on a cold GitHub runner
# that takes minutes, not the default's seconds: the first runs here failed with "iOS driver not ready
# in time" before a single step ran, for a good build and a broken one alike. In milliseconds.
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"
# No anonymous usage reports from CI.
export MAESTRO_CLI_NO_ANALYTICS=1

set +e
maestro --device "$UDID" test \
  --format junit --output "$OUT/report.xml" \
  --test-output-dir "$OUT" \
  "$@"
rc=$?
set -e

# Whatever the flow ended on, pass or fail: the first thing anyone wants when a step times out.
xcrun simctl io "$UDID" screenshot "$OUT/final.png" || true
xcrun simctl shutdown "$UDID" || true
exit "$rc"
