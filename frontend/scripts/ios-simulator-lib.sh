# Shared by ios-simulator-smoke.sh and ios-maestro.sh. Sourced, not run.

# First device of the given kind on the newest iOS runtime installed.
pick() {
  xcrun simctl list devices available -j | jq -r --arg kind "$1" '
    .devices | to_entries
    | map(select(.key | test("iOS")))
    | sort_by(.key | capture("iOS-(?<v>[0-9-]+)").v | split("-") | map(tonumber))
    | last.value | map(select(.name | startswith($kind))) | first.udid'
}
