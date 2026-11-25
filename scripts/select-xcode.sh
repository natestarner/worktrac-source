#!/usr/bin/env bash
# Selects the newest RELEASED Xcode of one major version on a GitHub macOS runner, and fails the job
# if there is none or if it doesn't carry that major's iOS SDK.
#
#   bash scripts/select-xcode.sh 27
#
# Why it fails instead of falling back: App Store Connect checks which SDK a binary was built with
# (ITMS-90725). Until 2026-11 this step picked "newest Xcode_26*" and silently kept the image's
# default when none matched, so builds went on using the iOS 26.2 SDK without anyone noticing.
# Apple requires the iOS 27 SDK for uploads from April 2027; a quiet fallback would only surface
# as a rejected upload. Betas are skipped: App Store Connect refuses binaries built with one.
#
# The runner label that carries the major (`xcode-27` today) is set in each workflow's `runs-on`,
# and bumped together with the argument here. See docs/architecture/native-apps.md.
set -euo pipefail

MAJOR="${1:?usage: select-xcode.sh <major version, e.g. 27>}"

echo "Xcode installs on this runner:"
ls -d /Applications/Xcode*.app 2>/dev/null || true

XC=$(ls -d /Applications/Xcode_"${MAJOR}"*.app 2>/dev/null | grep -vi beta | sort -V | tail -1 || true)
if [ -z "$XC" ]; then
  echo "::error::No released Xcode ${MAJOR} on this runner image. Check the job's runs-on label against actions/runner-images."
  exit 1
fi

sudo xcode-select -s "$XC"
xcodebuild -version

if ! xcodebuild -showsdks | grep -Eq "iphoneos${MAJOR}(\.|$|[[:space:]])"; then
  echo "::error::${XC} has no iOS ${MAJOR} SDK:"
  xcodebuild -showsdks
  exit 1
fi
echo "Building with $(xcodebuild -showsdks | grep -E "iphoneos${MAJOR}" | head -1 | sed 's/^[[:space:]]*//')"
