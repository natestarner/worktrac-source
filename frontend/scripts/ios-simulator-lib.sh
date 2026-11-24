# Shared by ios-simulator-smoke.sh and ios-maestro.sh. Sourced, not run.

# First device of the given kind on the newest iOS runtime installed.
# Keys look like com.apple.CoreSimulator.SimRuntime.iOS-27-2. Only the dash-separated NUMBERS are
# read: Xcode 27's image broke the older `[0-9-]+` capture ("" cannot be parsed as a number), so
# the runtime keys are logged to stderr for the next time a key changes shape.
pick() {
  xcrun simctl list devices available -j | jq -r '.devices | keys[]' >&2
  xcrun simctl list devices available -j | jq -r --arg kind "$1" '
    .devices | to_entries
    | map(select(.key | test("iOS-[0-9]")))
    | sort_by(.key | capture("iOS-(?<v>[0-9]+(-[0-9]+)*)").v | split("-") | map(tonumber))
    | last.value | map(select(.name | startswith($kind))) | first.udid'
}
