# Shared by ios-simulator-smoke.sh and ios-maestro.sh. Sourced, not run.

# First device of the given kind on the newest iOS runtime installed.
# Only GENERAL runtimes count: keys that end in the version, like ...SimRuntime.iOS-27-2. Xcode 27's
# image also ships device-specific ones (...iOS-27-2-iPhone19-4, holding a two-screen "iPhone Duo"
# whose screenshot needs --display); picking from that broke this step twice. The keys are logged
# to stderr so the next change of shape shows up in the job log.
pick() {
  xcrun simctl list devices available -j | jq -r '.devices | keys[]' >&2
  xcrun simctl list devices available -j | jq -r --arg kind "$1" '
    .devices | to_entries
    | map(select(.key | test("\\.iOS-[0-9]+(-[0-9]+)*$")))
    | sort_by(.key | capture("iOS-(?<v>[0-9]+(-[0-9]+)*)$").v | split("-") | map(tonumber))
    | last.value | map(select(.name | startswith($kind))) | first.udid'
}
