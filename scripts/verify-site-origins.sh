#!/usr/bin/env bash
#
# After a deploy: check that each live page names only its own environment, and that its share
# image is really an image.
#
# fill-site-origins.sh proves the files were filled before upload. This proves what a link preview
# actually gets: the deployed page, fetched over the network, the way iMessage or Slack fetches it.
# On 2026-10-29 dev.huddle.fitness's share image pointed at production, where that file did not
# exist yet, and production answered with its 404 page -- HTML, with a 200 status. Every page
# looked fine in a browser.
#
# For each URL it fails if the page:
#   - names any *huddle.fitness origin other than this environment's SITE_ORIGIN or APP_ORIGIN;
#   - still contains a __NAME__ placeholder;
#   - has an og:image or twitter:image that doesn't answer 200 with an image/* content type;
#   - carries a robots meta that isn't this environment's SITE_ROBOTS.
# Email addresses (support@huddle.fitness) are not origins and are left alone.
#
# Usage: bash scripts/verify-site-origins.sh <env-file> <url> [<url>...]
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <env-file> <url> [<url>...]" >&2
  exit 2
fi

env_file=$1
shift
[ -f "$env_file" ] || { echo "verify-site-origins: no such env file: $env_file" >&2; exit 2; }
read_key() {
  local value
  value=$(grep -E "^$1=" "$env_file" | tail -n 1 | cut -d= -f2- | tr -d '\r') || true
  printf '%s' "$value"
}
SITE_ORIGIN=$(read_key SITE_ORIGIN)
APP_ORIGIN=$(read_key APP_ORIGIN)
SITE_ROBOTS=$(read_key SITE_ROBOTS)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# A Static Web App can take a few seconds to serve a fresh upload everywhere; retry before calling
# a page missing.
fetch() {
  local url=$1 out=$2 attempt
  for attempt in 1 2 3 4 5 6; do
    if curl -fsSL --max-time 20 -o "$out" "$url"; then return 0; fi
    sleep 5
  done
  return 1
}

fails=0
fail() {
  printf '  FAIL  %s\n' "$1"
  fails=$((fails + 1))
}

for url in "$@"; do
  echo "Checking $url ..."
  page="$tmp/page.html"
  if ! fetch "$url" "$page"; then
    fail "$url did not load"
    continue
  fi

  while IFS= read -r origin; do
    [ -z "$origin" ] && continue
    if [ "$origin" != "$SITE_ORIGIN" ] && [ "$origin" != "$APP_ORIGIN" ]; then
      fail "$url names $origin, which is not this environment ($SITE_ORIGIN / $APP_ORIGIN)"
    fi
  done < <(grep -oE 'https?://([a-z0-9-]+\.)*huddle\.fitness' "$page" | sort -u)

  if grep -qE '__[A-Z][A-Z0-9_]*__' "$page"; then
    fail "$url still contains placeholders: $(grep -oE '__[A-Z][A-Z0-9_]*__' "$page" | sort -u | tr '\n' ' ')"
  fi

  robots=$(grep -oE '<meta name="robots" content="[^"]*"' "$page" | sed -E 's/.*content="([^"]*)"/\1/' | head -n 1 || true)
  if [ -n "$robots" ] && [ "$robots" != "$SITE_ROBOTS" ]; then
    fail "$url has robots '$robots', expected '$SITE_ROBOTS'"
  fi

  for image in $(grep -oE '<meta (property="og:image"|name="twitter:image") content="[^"]*"' "$page" \
    | sed -E 's/.*content="([^"]*)"/\1/' | sort -u); do
    type=$(curl -sS -o /dev/null --max-time 20 -w '%{http_code} %{content_type}' "$image" || echo "000 none")
    case "$type" in
      "200 image/"*) printf '  ok    share image %s (%s)\n' "$image" "${type#200 }" ;;
      *) fail "$url's share image $image answered '$type', not an image" ;;
    esac
  done
done

echo
if [ "$fails" -gt 0 ]; then
  echo "$fails check(s) failed."
  exit 1
fi
echo "Every page names only $SITE_ORIGIN / $APP_ORIGIN, and every share image is an image."
