#!/bin/sh
# Runs before 20-envsubst-on-templates.sh renders nginx.conf.template, so a bad
# SERVICE_URL stops the container instead of quietly breaking every /api/ call.
#
# Why this needs a guard at all: `location /api/` with `proxy_pass $SERVICE_URL`
# passes the request URI through *only* when SERVICE_URL has no URI part of its
# own. Add any path — a bare trailing slash counts — and nginx replaces the
# matched /api/ prefix with it instead:
#
#   http://service:8787        →  /api/health   ✓
#   http://service:8787/       →  /health       404
#   http://service:8787/api    →  /apihealth    404
#
# None of which is visible from outside: nginx still serves the app, and this
# container's healthcheck only asks for /, so it stays green while chat is dead.
set -e

fail() {
  echo "[web] SERVICE_URL=\"$SERVICE_URL\" — $1" >&2
  echo "[web] It must be a bare origin: scheme://host[:port], no path, no trailing slash." >&2
  echo "[web]   SERVICE_URL=http://service:8787" >&2
  exit 1
}

[ -n "$SERVICE_URL" ] || fail "it is empty"

case "$SERVICE_URL" in
  http://*|https://*) ;;
  *) fail "it has no http:// or https:// scheme" ;;
esac

# Everything after the scheme must be host[:port] and nothing else.
case "${SERVICE_URL#*://}" in
  */*) fail "it has a path or a trailing slash, which nginx would substitute for the /api/ prefix" ;;
  '')  fail "it has no host" ;;
esac

echo "[web] SERVICE_URL=$SERVICE_URL — /api/ will proxy there with the path preserved"
