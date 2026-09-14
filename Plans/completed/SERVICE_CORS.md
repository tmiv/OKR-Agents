---
tags:
  - plan
  - service
  - deploy
status: completed
created: 2026-09-13
completed_on: 2026-09-13
predecessors:
  - completed/DOCKER_IMAGES_AND_CI.md
---
# Plan: Gate the service on the app's origin, and name both hosts in env

## Context
[DOCKER_IMAGES_AND_CI](DOCKER_IMAGES_AND_CI.md) shipped a web container that proxies
`/api/` to the service, so in the normal path the browser only ever talks to one origin and CORS
never comes up. The service has no `Access-Control-*` handling at all — grep `service/index.js`
and there is nothing between `express.json()` and the routes.

That is fine until the service port is reachable from a browser: the commented-out `ports:` block
in [docker-compose.yml:30](../../docker-compose.yml), a compose override, a LAN deploy, a gateway
that exposes both. Then any page on any origin can POST to `/api/chat` and spend the account's
tokens. The proxy is the happy path, not a boundary.

Half of the ask is already true: `SERVICE_URL` on the web container
([web/Dockerfile:83](../../web/Dockerfile), [docker-compose.yml:38](../../docker-compose.yml))
is exactly "the service host as an env var on the web container". This plan adds the other half
and documents the pair.

## Goal
A browser origin that is not `APP_ORIGIN` cannot use the service, and both containers name the
other host in an environment variable.

## Decisions (locked in)
1. **`APP_ORIGIN` on the service container**, a comma-separated list of full origins. An *origin*
   is `scheme://host[:port]` — that is what a browser puts in the header and what CORS compares,
   so a bare hostname is a configuration error, not a shorthand.
2. **No `Origin` header ⇒ allowed.** Same-origin GETs, the container healthcheck and any
   server-side caller send none. Rejecting them would break the healthcheck and protect nobody:
   CORS is enforced by the browser, and a non-browser client never asks.
3. **A present-but-unlisted `Origin` gets 403, not just a missing header.** Omitting
   `Access-Control-Allow-Origin` is enough to make a browser block the *response*, but the request
   has already run and already cost tokens. Refusing before the handler is the point.
4. **Default `http://localhost:5173`** when unset — the documented dev origin
   ([README.md:143](../../README.md)), so `npm run dev:*` keeps working with no new setup. The
   allowlist is logged at boot so a mismatch is one line away.
5. **`APP_ORIGIN=*` is an explicit opt-out**, echoing whatever origin asks. Deployments behind
   their own gateway need a door; an undocumented one gets improvised worse.
6. **The proxy path must keep working unchanged.** nginx forwards the browser's `Origin`, so with
   compose the service sees `http://localhost:8080` and that is what `APP_ORIGIN` is set to.

## Phase 1 — CORS middleware
`service/index.js`: parse `APP_ORIGIN` next to `PORT` at :8, add the middleware above
`express.json()` at :10 so a refused origin never gets its body parsed, answer `OPTIONS` preflight
with 204, and name the allowlist in the boot log at :132.

## Phase 2 — Wire it through
`service/.env.example`, `docker-compose.yml` (`APP_ORIGIN=http://localhost:8080`, matching the
published web port), and a README note pairing it with `SERVICE_URL`.

## Phase 3 — Prove it in CI
Add smoke steps to [.github/workflows/docker.yml](../../.github/workflows/docker.yml): the allowed
origin gets `Access-Control-Allow-Origin` back through the proxy, a foreign origin gets 403, and
the no-Origin health probe still passes.

## Verification
- Through the proxy: allowed origin → 200 + `Access-Control-Allow-Origin`; `https://evil.test` →
  403; no `Origin` → 200. The 403 through the proxy is also what proves nginx forwards `Origin`.
- Directly against the service port, same three.
- `OPTIONS` preflight → 204 with the allow headers.
- Container healthcheck still reports `healthy` (it sends no `Origin`).
- `npm run dev:service` + `npm run dev:web` still work with no `APP_ORIGIN` set.

## Out of scope
Auth, rate limiting or per-user quotas — CORS stops a browser on another origin, not a script with
curl. A service that is genuinely public needs an actual credential, and that is its own plan.

## Risks / rollback
A wrong `APP_ORIGIN` breaks chat with a 403 while health stays green, because health sends no
`Origin`. The boot log prints the allowlist and every refusal logs the origin it refused, so the
mismatch is visible. Rollback is `APP_ORIGIN=*`.

## Completion notes
- **Planned vs. actual.** All three phases landed as written. Decision 2 (no `Origin` ⇒ allow) is
  what keeps the container healthcheck green, and Decision 6 held: nginx forwards the browser's
  `Origin` untouched, which the 403-through-the-proxy test proves directly. `SERVICE_URL` needed no
  work — it was already the web container's env var for the service host.
- **Mid-flight adjustments.** None to the design. One test-harness correction: the first round of
  direct checks ran against a stale `okr-viewer-service:test` image (compose had rebuilt
  `:latest`), and reported no CORS headers at all. Rebuilding the tag fixed it. Worth remembering —
  a green-looking "CORS is off" result was the tag, not the code.
- **Surprises / residual risks.** Verified against the running pair and standalone: allowed origin
  200 + `Access-Control-Allow-Origin`, foreign origin 403 with a `[cors] refused` log line, no
  `Origin` 200, preflight 204, comma-separated list honoured, `*` echoes any origin, unset defaults
  to `http://localhost:5173`, both containers `healthy` throughout. The residual risk is the one in
  Risks above and it is real: `APP_ORIGIN` pointing at the wrong scheme or port breaks chat while
  health stays green. The boot line exists for exactly that. Note also that this is not an auth
  boundary — see Out of scope.
