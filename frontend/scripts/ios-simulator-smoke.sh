#!/usr/bin/env bash
# Boots the unsigned simulator build on the newest iPhone and iPad simulators, screenshots it in
# light and dark mode, and keeps the app's own console. Runs on a GitHub macOS runner
# (mobile-ci.yml); there is no Mac locally, so these artifacts are how the app is seen at all.
#
# The console comes from `simctl launch --console-pty`, NOT the unified log: Capacitor prints the
# WebView's console.* (the "⚡️  [log]" lines) to stdout, so `log show` never contains it.
#
# Usage: bash scripts/ios-simulator-smoke.sh <path/to/App.app> <out-dir>
set -euo pipefail

APP="$1"
OUT="$2"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
mkdir -p "$OUT"

# First device of the given kind on the newest iOS runtime installed.
pick() {
  xcrun simctl list devices available -j | jq -r --arg kind "$1" '
    .devices | to_entries
    | map(select(.key | test("iOS")))
    | sort_by(.key | capture("iOS-(?<v>[0-9-]+)").v | split("-") | map(tonumber))
    | last.value | map(select(.name | startswith($kind))) | first.udid'
}

for KIND in iPhone iPad; do
  UDID=$(pick "$KIND")
  NAME=$(xcrun simctl list devices -j | jq -r --arg u "$UDID" '.devices[][] | select(.udid==$u) | .name')
  echo "== $KIND: $NAME ($UDID)"
  xcrun simctl boot "$UDID"
  xcrun simctl bootstatus "$UDID" -b
  xcrun simctl ui "$UDID" appearance light
  xcrun simctl install "$UDID" "$APP"

  xcrun simctl launch --console-pty "$UDID" "$BUNDLE_ID" > "$OUT/$KIND-console.log" 2>&1 &
  CONSOLE_PID=$!
  sleep 20
  xcrun simctl io "$UDID" screenshot "$OUT/$KIND-light.png"

  # A trait change reaches the WebView's prefers-color-scheme a beat later on iPad than on iPhone;
  # 4s produced a light screenshot labelled dark there.
  xcrun simctl ui "$UDID" appearance dark
  sleep 10
  xcrun simctl io "$UDID" screenshot "$OUT/$KIND-dark.png"

  kill "$CONSOLE_PID" 2>/dev/null || true
  xcrun simctl shutdown "$UDID"
done

# Anything the WebView logged as an error is worth seeing in the job log, not only the artifact.
grep -hiE 'error|unhandled|failed' "$OUT"/*-console.log | head -40 || true
