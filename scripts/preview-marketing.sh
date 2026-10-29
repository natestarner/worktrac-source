#!/usr/bin/env bash
#
# Serve the marketing site locally the way a deploy serves it: a copy filled with the local origins
# (scripts/site-origins.local.env), never marketing/ itself, whose pages hold __SITE_ORIGIN__-style
# placeholders. CI's marketing-ci runs this too, so the e2e suite reads what a deploy uploads.
#
# Serves on the port named in SITE_ORIGIN (8099), which is what playwright.marketing.config.ts
# expects. Runs in the foreground; stop it with Ctrl+C.
#
# Usage: bash scripts/preview-marketing.sh
#        cd e2e && npm run test:marketing      (in another shell)
set -euo pipefail

cd "$(dirname "$0")/.."

env_file=scripts/site-origins.local.env
port=$(grep -E '^SITE_ORIGIN=' "$env_file" | cut -d= -f2- | tr -d '\r' | sed -E 's#.*:([0-9]+)$#\1#')
out="${TMPDIR:-/tmp}/huddle-marketing-preview"

rm -rf "$out"
mkdir -p "$out"
cp -r marketing/. "$out/"
rm -rf "$out/design"   # the Claude Design canvas source, never part of the site
bash scripts/fill-site-origins.sh "$env_file" "$out"

# `python -m http.server` queues only 5 waiting connections, and on Windows a connection beyond that
# is refused outright rather than held. The marketing suite runs 16 workers, so it failed at random
# with ERR_CONNECTION_REFUSED on a page that was fine. Same server, a queue of 128, both IPv4 and IPv6.
py=python3
"$py" -c '' 2>/dev/null || py=python   # Windows' python3 is often the Microsoft Store stub
echo "Serving $out at http://localhost:$port/"
exec "$py" - "$port" "$out" <<'PY'
import functools, http.server, socket, sys

class Server(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6
    request_queue_size = 128

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()

port, directory = int(sys.argv[1]), sys.argv[2]
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
Server(("::", port), handler).serve_forever()
PY
