#!/usr/bin/env bash
#
# Static checks for the marketing site (marketing/).
#
# The site has no build step -- it ships exactly as authored -- so nothing else
# would catch a broken reference before it reached a Static Web App. These are
# the checks that have real failure modes here:
#
#   1. Required files exist          -- a missing styles.css deploys silently.
#   2. Every local href/src resolves -- a typo'd asset path 404s in production.
#   3. No insecure http:// links     -- mixed content is blocked by the browser.
#   4. No dev host in source         -- the dev URL is applied at runtime by
#                                       app-links.js, never hardcoded.
#   5. Every <img> has alt           -- the design-system accessibility bar.
#   6. Canonical + og:url agree      -- www serves identical content, so a
#                                       disagreement splits the indexing.
#   7. No retired brand colour       -- brand v3 dropped the teal #163b3e this
#                                       site used to carry; a stray copy is the
#                                       one regression nothing else would catch.
#  12. Unknown URLs answer 404       -- not the homepage with a 200, which made
#                                       every bad URL a duplicate homepage.
#
# Usage: bash scripts/check-marketing.sh
set -euo pipefail

cd "$(dirname "$0")/.."

DIR="marketing"
INDEX="$DIR/index.html"

# Every page the site serves. Checks 2, 4, 5 and 6 below run over ALL of them -- they read only
# index.html while it was the only page, which would have left a second audience page's asset
# paths, dev hosts, alt text and canonical URL entirely unchecked.
PAGES=("$DIR"/*.html)

# The not-found page is served for URLs that match nothing (check 12). It is deliberately not
# indexable, so it has no canonical (check 6) and no sitemap entry (check 9); every other check
# still reads it.
NOT_FOUND="$DIR/404.html"

fails=0

fail() {
  printf '  FAIL  %s\n' "$1"
  fails=$((fails + 1))
}

pass() {
  printf '  ok    %s\n' "$1"
}

echo "Checking $DIR ..."

# --- 1. Required files -------------------------------------------------------
for f in index.html styles.css app-links.js robots.txt sitemap.xml staticwebapp.config.json; do
  if [ -f "$DIR/$f" ]; then
    pass "$f present"
  else
    fail "$f is missing"
  fi
done

# Bail out early if the page itself is gone; every check below reads it.
if [ ! -f "$INDEX" ]; then
  echo
  echo "$fails check(s) failed."
  exit 1
fi

# --- 2. Local references resolve --------------------------------------------
# Root-relative refs only (href/src/srcset="/..."); external URLs and in-page
# anchors are skipped.
missing_refs=0
# EVERY page, not just index.html. A second page would otherwise carry unchecked asset paths that
# 404 in production -- silently, as a missing stylesheet rather than an error.
for page in "${PAGES[@]}"; do
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    # A bare "/" (and any directory ref) is served as that directory's index.html.
    case "$ref" in
      */) target="$DIR${ref}index.html" ;;
      *) target="$DIR$ref" ;;
    esac
    if [ ! -f "$target" ]; then
      fail "$(basename "$page") references a file that does not exist: $ref"
      missing_refs=$((missing_refs + 1))
    fi
  done < <(grep -oE '(href|src|srcset)="/[^"#]*"' "$page" | sed -E 's/^(href|src|srcset)="//; s/"$//' | sort -u)
done

if [ "$missing_refs" -eq 0 ]; then
  pass "all local references resolve"
fi

# --- 3. No insecure links ----------------------------------------------------
if grep -qE 'http://' "$DIR"/*.html "$DIR"/*.css "$DIR"/*.js; then
  fail "insecure http:// reference found"
  grep -nE 'http://' "$DIR"/*.html "$DIR"/*.css "$DIR"/*.js | sed 's/^/        /'
else
  pass "no insecure http:// references"
fi

# --- 4. No dev host hardcoded in the page ------------------------------------
# app-links.js legitimately names it; index.html must not.
dev_host=0
for page in "${PAGES[@]}"; do
  if grep -q 'app\.dev\.huddle\.fitness' "$page"; then
    fail "$(basename "$page") hardcodes app.dev.huddle.fitness (app-links.js applies it at runtime)"
    dev_host=$((dev_host + 1))
  fi
done
[ "$dev_host" -eq 0 ] && pass "no dev host hardcoded in any page"

# --- 5. Every <img> has an alt attribute -------------------------------------
missing_alt=0
for page in "${PAGES[@]}"; do
  if grep -oE '<img[^>]*>' "$page" | grep -qv 'alt='; then
    fail "$(basename "$page") has an <img> with no alt="
    grep -oE '<img[^>]*>' "$page" | grep -v 'alt=' | sed 's/^/        /'
    missing_alt=$((missing_alt + 1))
  fi
done
[ "$missing_alt" -eq 0 ] && pass "every <img> has alt"

# --- 6. Canonical and og:url agree -------------------------------------------
# Per page, and a page with no canonical at all is a failure. Two audience pages sharing one
# canonical URL is exactly how one of them stops being indexed -- which is invisible from the page.
canon_fails=0
declare -A seen_canonical
for page in "${PAGES[@]}"; do
  [ "$page" = "$NOT_FOUND" ] && continue
  name=$(basename "$page")
  canonical=$(grep -oE '<link rel="canonical" href="[^"]*"' "$page" | sed -E 's/.*href="([^"]*)".*/\1/')
  ogurl=$(grep -oE '<meta property="og:url" content="[^"]*"' "$page" | sed -E 's/.*content="([^"]*)".*/\1/')
  if [ -z "$canonical" ]; then
    fail "$name has no canonical link"
    canon_fails=$((canon_fails + 1))
  elif [ -n "$ogurl" ] && [ "$canonical" != "$ogurl" ]; then
    fail "$name: canonical ($canonical) and og:url ($ogurl) disagree"
    canon_fails=$((canon_fails + 1))
  elif [ -n "${seen_canonical[$canonical]:-}" ]; then
    fail "$name shares a canonical URL with ${seen_canonical[$canonical]} ($canonical)"
    canon_fails=$((canon_fails + 1))
  else
    seen_canonical[$canonical]="$name"
  fi
done
[ "$canon_fails" -eq 0 ] && pass "every page has its own canonical, matching its og:url"

# --- 7. No retired brand colour ----------------------------------------------
# The v3 mark is #e8734a / #f2a65a / #f2ede1 / #b5542d and the wordmark inks are
# #3e3a37 and #f2ede1. The teal that used to sit in the mark and in the palette
# is retired -- see docs/brand/README.md. Matched case-insensitively: the inline
# marks are lowercase and the kit's own files are upper.
if grep -riq '163b3e' "$DIR"/*.html "$DIR"/*.css "$DIR"/*.js; then
  fail "retired teal #163b3e found (brand v3 replaced it)"
  grep -rin '163b3e' "$DIR"/*.html "$DIR"/*.css "$DIR"/*.js | sed 's/^/        /'
else
  pass "no retired teal #163b3e"
fi

# --- 8. Every page loads app-links.js ----------------------------------------
# It rewrites every CTA host on the dev deployment and injects noindex there. A page that forgets it
# sends lower-environment visitors to the PRODUCTION app and lets the lower landing page be indexed
# alongside the real one -- neither of which is visible from the page itself.
missing_links=0
for page in "${PAGES[@]}"; do
  if ! grep -q 'src="/app-links.js"' "$page"; then
    fail "$(basename "$page") does not load app-links.js"
    missing_links=$((missing_links + 1))
  fi
done
[ "$missing_links" -eq 0 ] && pass "every page loads app-links.js"

# --- 9. Every page is in the sitemap -----------------------------------------
# A page nobody links to and nothing lists is a page that does not exist as far as search is
# concerned, and adding one is exactly when this is forgotten.
missing_sitemap=0
for page in "${PAGES[@]}"; do
  [ "$page" = "$NOT_FOUND" ] && continue
  name=$(basename "$page")
  slug="$name"
  [ "$name" = "index.html" ] && slug=""
  if ! grep -q "huddle.fitness/$slug<" "$DIR/sitemap.xml"; then
    fail "$name is not listed in sitemap.xml"
    missing_sitemap=$((missing_sitemap + 1))
  fi
done
[ "$missing_sitemap" -eq 0 ] && pass "every page is in sitemap.xml"

# --- 10. Every App Store reference names the same, real app ------------------
# The badge links, the FAQ link and Safari's Smart App Banner each carry the app's numeric App Store
# id. A typo in one sends people to somebody else's app or to a "not available" page, and nothing on
# our side would show it.
store_ids=$(grep -ohE 'apps\.apple\.com/[^"]*/id[^"/?]+|apple-itunes-app" content="app-id=[^"]+' "${PAGES[@]}" \
  | sed -E 's#.*/id##; s#.*app-id=##' | sort -u)
if [ -z "$store_ids" ]; then
  pass "no App Store links"
elif [ "$(printf '%s\n' "$store_ids" | wc -l)" -ne 1 ]; then
  fail "App Store links disagree on the app id: $(echo $store_ids)"
elif ! printf '%s' "$store_ids" | grep -qE '^[0-9]+$'; then
  fail "App Store app id is not a number: $store_ids"
else
  pass "every App Store link names app id $store_ids"
fi

# --- 11. Every video format the pages use has a MIME type in the SWA config ----------------------
# Azure Static Web Apps serves an extension it doesn't know as application/octet-stream, and this
# site sends X-Content-Type-Options: nosniff, so a browser takes that at face value. Chrome falls
# back to another <source>; Safari, which plays only the MP4, shows the poster instead of the clip.
# The local preview (python http.server) sends the right type, so nothing local catches this.
# Shipped broken 2026-10-28 (.mp4 unmapped); found by curl on the deployed lower site.
missing_mime=0
for ext in $(grep -ohE '\.(mp4|webm|mov|m4v|ogv)"' "${PAGES[@]}" | tr -d '"' | sort -u); do
  if ! grep -qF "\"$ext\": \"video/" "$DIR/staticwebapp.config.json"; then
    fail "staticwebapp.config.json has no video MIME type for $ext (it would be served as application/octet-stream)"
    missing_mime=$((missing_mime + 1))
  fi
done
[ "$missing_mime" -eq 0 ] && pass "every video format on the pages has a MIME type"

# --- 12. Unknown URLs get a real 404 ------------------------------------------------------------
# The override used to rewrite to /index.html with "statusCode": 200, so every mistyped or retired
# URL answered as a copy of the homepage, which search engines treat as duplicate content. It must
# rewrite to the not-found page and leave the 404 status alone, and that page must say noindex.
override=$(grep -oE '"404": *\{[^}]*\}' "$DIR/staticwebapp.config.json" || true)
if [ -z "$override" ]; then
  fail "staticwebapp.config.json has no 404 override (SWA would serve its own generic page)"
elif printf '%s' "$override" | grep -q 'statusCode'; then
  fail "staticwebapp.config.json's 404 override sets a statusCode; a not-found URL must answer 404"
elif ! printf '%s' "$override" | grep -q '"rewrite": *"/404.html"'; then
  fail "staticwebapp.config.json's 404 override does not rewrite to /404.html: $override"
elif [ ! -f "$NOT_FOUND" ]; then
  fail "404.html is missing"
elif ! grep -q '<meta name="robots" content="noindex"' "$NOT_FOUND"; then
  fail "404.html does not carry a noindex robots meta"
else
  pass "unknown URLs answer 404 with a noindex page"
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "$fails check(s) failed."
  exit 1
fi
echo "All marketing checks passed."
