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
# Stop apsd, iOS's push daemon. On the runner it can't hold a connection to sandbox.push.apple.com and
# retried ~22 times a second -- each a TLS handshake, keychain reads and a status notice to a dozen
# other daemons -- for the whole run: ~55% of the simulator's log lines and a steady drain on a
# 3-core runner where taps took 3-17s (2026-11-04). The app uses no push notifications. What
# happened, and whether launchd brought it back, goes to apsd.log in the artifact.
APSD_PATTERN='ApplePushService.framework/apsd'
{
  echo "before: $(pgrep -f "$APSD_PATTERN" | tr '\n' ' ')"
  xcrun simctl spawn "$UDID" launchctl bootout system/com.apple.apsd 2>&1 ||
    xcrun simctl spawn "$UDID" launchctl disable system/com.apple.apsd 2>&1 || true
  pkill -f "$APSD_PATTERN" 2>&1 || true
  sleep 5
  echo "after 5s: $(pgrep -f "$APSD_PATTERN" | tr '\n' ' ')"
} > "$OUT/apsd.log" 2>&1
# The Simulator app attached to the device: XCTest's first app launch on a headless runner is where
# the hang above happened, and a device with its UI host running is the configuration Xcode expects.
open -a Simulator --args -CurrentDeviceUDID "$UDID" || true
xcrun simctl ui "$UDID" appearance light
xcrun simctl install "$UDID" "$APP"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
# Approve the app's own scheme for links the simulator opens (Maestro's openLink), as lsd records it
# after someone taps "Open" on its "Open in Huddle?" prompt. That prompt is the simulator's, not one
# a person sees: they get Safari's after "Return to the Huddle app". On the runner lsd took 28-90s
# AFTER "Open" was tapped to act on it, and flow 03 failed waiting for Billing (#434, 2026-11-04:
# SpringBoard dismissed the prompt at once; lsd's prompt thread sat in
# CFUserNotificationReceiveResponse until it saved this key, then opened the app). With the key
# already set, lsd skips the prompt and the link reached the app in ~10s. The scheme is the bundle
# id (Info.plist's CFBundleURLSchemes).
xcrun simctl spawn "$UDID" defaults write com.apple.launchservices.schemeapproval \
  "com.apple.CoreSimulator.CoreSimulatorBridge-->$BUNDLE_ID" -string "$BUNDLE_ID"

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

# With LOWER_HEALTH_URL set (mobile-flows.yml), keep lower warm for as long as the flows run. Lower is
# min-replicas=0 (resilience.md, "Cold start"), and the seed step is the last request it sees before
# flow 01: the simulator boot above and Maestro's first driver start then take 5-17 minutes, lower
# scales back to zero, and flow 01's sign-in met the cold start -- "Couldn't reach Huddle" on
# 2026-11-02 and twice on 11-03, while every later flow signed in fine. The flows pin what only the
# app can break, not lower's cold start; a cold backend is the Playwright suite's to cover. Every
# ping goes to lower-keep-warm.log in the artifact, with how long it took.
BG_PIDS=()
trap 'for p in ${BG_PIDS[@]+"${BG_PIDS[@]}"}; do kill "$p" 2>/dev/null; done; true' EXIT

# What the runner is busy with: the top processes by CPU every 30s, for the whole run (host-top.log
# in the artifact). The simulator's processes are host processes, so iOS's daemons show here too.
top -l 0 -s 30 -n 12 -o cpu -stats pid,command,cpu,rsize > "$OUT/host-top.log" 2>&1 &
BG_PIDS+=($!)

if [ -n "${LOWER_HEALTH_URL:-}" ]; then
  ping_lower() {
    curl -s -o /dev/null -w "$(date -u +%H:%M:%S) %{http_code} %{time_total}s\n" --max-time 90 \
      "$LOWER_HEALTH_URL" >> "$OUT/lower-keep-warm.log" 2>/dev/null ||
      echo "$(date -u +%H:%M:%S) 000 (no answer in 90s)" >> "$OUT/lower-keep-warm.log"
  }
  deadline=$(( $(date +%s) + 180 ))
  until ping_lower && tail -n 1 "$OUT/lower-keep-warm.log" | grep -q ' 200 '; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "::warning::Lower did not answer 200 within 180s; running the flows anyway."
      break
    fi
    sleep 5
  done
  echo "== lower: $(tail -n 1 "$OUT/lower-keep-warm.log")"
  ( while true; do sleep 60; ping_lower; done ) &
  BG_PIDS+=($!)
fi

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
  # The app's own console (Capacitor's bridge log and the page's console.*), written by Debug builds
  # launched with huddleConsoleToFile (AppDelegate.swift). Absent for a flow that never got that far.
  local data
  data=$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data 2>/dev/null) &&
    cp "$data/Documents/console.log" "$OUT/console-$name.log" 2>/dev/null || true
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
echo "apsd at the end: $(pgrep -f "$APSD_PATTERN" | tr '\n' ' ')" >> "$OUT/apsd.log"

# Whatever the last flow ended on, pass or fail: the first thing anyone wants when a step times out.
xcrun simctl io "$UDID" screenshot "$OUT/final.png" || true
xcrun simctl shutdown "$UDID" || true
xcrun simctl delete "$UDID" || true
exit "$rc"
