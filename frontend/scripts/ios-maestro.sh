#!/usr/bin/env bash
# Runs Maestro flows against the unsigned simulator build on a fresh iPhone simulator, on a GitHub
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

# A FRESH device of the same model and runtime as the newest iPhone, not that iPhone itself.
# ios-simulator-smoke.sh has just booted and shut that one down, and re-booting it is where Maestro's
# driver hung: its runner app never launched, and after five minutes the simulator's launch service
# died ("(ipc/mig) server died", 2026-10-25, Xcode 26.3 / iOS 26.2).
TEMPLATE=$(pick iPhone)
read -r TYPE RUNTIME < <(xcrun simctl list devices -j | jq -r --arg u "$TEMPLATE" '
  .devices | to_entries[] | .key as $rt | .value[] | select(.udid == $u) | "\(.deviceTypeIdentifier) \($rt)"')
UDID=$(xcrun simctl create "maestro-iphone" "$TYPE" "$RUNTIME")
echo "== fresh $TYPE on $RUNTIME: $UDID"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
# A fresh device shows iOS's one-time "slide to type" keyboard tutorial over the keyboard the first
# time one appears, and it sat over a search field mid-flow (2026-10-25). Mark it already seen.
xcrun simctl spawn "$UDID" defaults write com.apple.Preferences DidShowContinuousPathIntroduction -bool true || true
xcrun simctl spawn "$UDID" defaults write com.apple.keyboard.preferences KeyboardContinuousPathEnabled -bool false || true
# The Simulator app attached to the device: XCTest's first app launch on a headless runner is where
# the hang above happened, and a device with its UI host running is the configuration Xcode expects.
open -a Simulator --args -CurrentDeviceUDID "$UDID" || true
xcrun simctl ui "$UDID" appearance light
xcrun simctl install "$UDID" "$APP"

# Maestro drives iOS through an XCTest runner it installs on first use, which takes minutes on a cold
# runner. In milliseconds.
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"
# No anonymous usage reports from CI.
export MAESTRO_CLI_NO_ANALYTICS=1

# One Maestro session per flow FILE, with the app force-quit between them. In one session, a flow that
# left an iOS sheet or prompt over the app (the share sheet, "Open in Huddle?") made the next flow's
# launchApp fail with "App did not stop in time" before any of its steps ran -- a cascade that cost
# two or three flows a run (2026-10-25). A directory argument is expanded to its *.yaml files.
FLOWS=()
for arg in "$@"; do
  if [ -d "$arg" ]; then
    for f in "$arg"/*.yaml; do FLOWS+=("$f"); done
  else
    FLOWS+=("$arg")
  fi
done
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")

run_flow() {
  local flow="$1" name
  name=$(basename "$flow" .yaml)
  maestro --device "$UDID" test \
    --format junit --output "$OUT/report-$name.xml" \
    --test-output-dir "$OUT" \
    --debug-output "$OUT/debug" \
    "$flow" 2>&1 | tee "$OUT/.last-run.log"
  local status="${PIPESTATUS[0]}"
  cat "$OUT/.last-run.log" >> "$OUT/maestro-run.log"
  return "$status"
}

set +e
rc=0
for flow in "${FLOWS[@]}"; do
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1
  run_flow "$flow"
  frc=$?
  # One retry, and ONLY when the driver never started: that is the runner's simulator, not the app,
  # and no step of the flow ran. A flow that ran and failed is never retried -- that is the signal.
  if [ "$frc" -ne 0 ] && grep -q "iOS driver not ready in time" "$OUT/.last-run.log"; then
    echo "::warning::Maestro's iOS driver never started for $flow; retrying it once."
    run_flow "$flow"
    frc=$?
  fi
  [ "$frc" -ne 0 ] && rc=1
done
set -e
echo "== Summary"
grep -E '^\[(Passed|Failed)\]' "$OUT/maestro-run.log" || true

# Whatever the last flow ended on, pass or fail: the first thing anyone wants when a step times out.
xcrun simctl io "$UDID" screenshot "$OUT/final.png" || true
xcrun simctl shutdown "$UDID" || true
xcrun simctl delete "$UDID" || true
exit "$rc"
