#!/usr/bin/env bash
#
# Fill an environment's own origins into the HTML that link previews and crawlers read.
#
# The marketing site and the app's index.html are built once and promoted unchanged from lower to
# production, so neither can carry an environment's address. Wherever a page must name an absolute
# URL (canonical, og:url, og:image, structured data, the app CTAs, the sitemap) the source says
# __SITE_ORIGIN__ or __APP_ORIGIN__ instead, and the robots meta says __SITE_ROBOTS__. Every deploy
# runs this on the files it is about to upload, with that environment's config -- lower and
# production alike, so lower exercises exactly the step production will run.
#
# Why not config.json, the way the app gets its API origin: link previews (iMessage, Slack, Signal)
# and most crawlers read the raw HTML and never run a script. A preview of a dev.huddle.fitness link
# built from production's addresses is how the share image went missing on 2026-10-29.
#
# It reads *.html, *.xml and *.txt only, and fails if ANY __NAME__ placeholder survives, so a new
# placeholder nobody configured stops the deploy instead of shipping as literal text.
#
# Usage: bash scripts/fill-site-origins.sh <env-file> <dir> [<dir>...]
#   <env-file>  KEY=VALUE lines naming SITE_ORIGIN, APP_ORIGIN and SITE_ROBOTS. Deployed
#               environments keep theirs in worktrac-deploy's config/<env>/site-origins.env; local
#               and CI previews use scripts/site-origins.local.env.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <env-file> <dir> [<dir>...]" >&2
  exit 2
fi

env_file=$1
shift
[ -f "$env_file" ] || { echo "fill-site-origins: no such env file: $env_file" >&2; exit 2; }

# Read the three keys by name rather than sourcing the file: it is config, not a script.
read_key() {
  local value
  value=$(grep -E "^$1=" "$env_file" | tail -n 1 | cut -d= -f2- | tr -d '\r') || true
  printf '%s' "$value"
}
SITE_ORIGIN=$(read_key SITE_ORIGIN)
APP_ORIGIN=$(read_key APP_ORIGIN)
SITE_ROBOTS=$(read_key SITE_ROBOTS)

# An origin is a scheme and a host, nothing after it: the pages append their own paths. https
# everywhere but a local preview. Validating also keeps every value safe inside the sed below.
origin_re='^(https://[a-z0-9.-]+|http://localhost(:[0-9]+)?)$'
for pair in "SITE_ORIGIN=$SITE_ORIGIN" "APP_ORIGIN=$APP_ORIGIN"; do
  if ! printf '%s' "${pair#*=}" | grep -qE "$origin_re"; then
    echo "fill-site-origins: ${pair%%=*} must be an origin like https://huddle.fitness (no path, no trailing slash); got '${pair#*=}'" >&2
    exit 1
  fi
done
if ! printf '%s' "$SITE_ROBOTS" | grep -qE '^[a-z]+(, ?[a-z]+)*$'; then
  echo "fill-site-origins: SITE_ROBOTS must be a robots directive list like 'index, follow'; got '$SITE_ROBOTS'" >&2
  exit 1
fi

placeholder_re='__[A-Z][A-Z0-9_]*__'
filled=0
leftover=0
for dir in "$@"; do
  [ -d "$dir" ] || { echo "fill-site-origins: no such directory: $dir" >&2; exit 2; }
  while IFS= read -r -d '' f; do
    grep -qE "$placeholder_re" "$f" || continue
    sed -i \
      -e "s#__SITE_ORIGIN__#$SITE_ORIGIN#g" \
      -e "s#__APP_ORIGIN__#$APP_ORIGIN#g" \
      -e "s#__SITE_ROBOTS__#$SITE_ROBOTS#g" \
      -- "$f"
    filled=$((filled + 1))
    if grep -qE "$placeholder_re" "$f"; then
      echo "fill-site-origins: $f still has a placeholder this script does not know:" >&2
      grep -noE "$placeholder_re" "$f" | sed 's/^/    /' >&2
      leftover=$((leftover + 1))
    fi
  done < <(find "$dir" -type f \( -name '*.html' -o -name '*.xml' -o -name '*.txt' \) -print0)
done

if [ "$leftover" -gt 0 ]; then
  echo "fill-site-origins: $leftover file(s) left unfilled; refusing to let them ship." >&2
  exit 1
fi
echo "fill-site-origins: filled $filled file(s) with SITE_ORIGIN=$SITE_ORIGIN APP_ORIGIN=$APP_ORIGIN SITE_ROBOTS='$SITE_ROBOTS'"
