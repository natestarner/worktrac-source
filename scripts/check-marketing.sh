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
#
# Usage: bash scripts/check-marketing.sh
set -euo pipefail

cd "$(dirname "$0")/.."

DIR="marketing"
INDEX="$DIR/index.html"
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
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  # A bare "/" (and any directory ref) is served as that directory's index.html.
  case "$ref" in
    */) target="$DIR${ref}index.html" ;;
    *) target="$DIR$ref" ;;
  esac
  if [ ! -f "$target" ]; then
    fail "referenced file does not exist: $ref"
    missing_refs=$((missing_refs + 1))
  fi
done < <(grep -oE '(href|src|srcset)="/[^"#]*"' "$INDEX" | sed -E 's/^(href|src|srcset)="//; s/"$//' | sort -u)

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
if grep -q 'app\.dev\.huddle\.fitness' "$INDEX"; then
  fail "index.html hardcodes app.dev.huddle.fitness (app-links.js applies it at runtime)"
else
  pass "no dev host hardcoded in index.html"
fi

# --- 5. Every <img> has an alt attribute -------------------------------------
if grep -oE '<img[^>]*>' "$INDEX" | grep -qv 'alt='; then
  fail "an <img> tag is missing alt="
  grep -oE '<img[^>]*>' "$INDEX" | grep -v 'alt=' | sed 's/^/        /'
else
  pass "every <img> has alt"
fi

# --- 6. Canonical and og:url agree -------------------------------------------
canonical=$(grep -oE '<link rel="canonical" href="[^"]*"' "$INDEX" | sed -E 's/.*href="([^"]*)".*/\1/')
ogurl=$(grep -oE '<meta property="og:url" content="[^"]*"' "$INDEX" | sed -E 's/.*content="([^"]*)".*/\1/')
if [ -z "$canonical" ]; then
  fail "no canonical link"
elif [ "$canonical" != "$ogurl" ]; then
  fail "canonical ($canonical) and og:url ($ogurl) disagree"
else
  pass "canonical and og:url agree ($canonical)"
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "$fails check(s) failed."
  exit 1
fi
echo "All marketing checks passed."
