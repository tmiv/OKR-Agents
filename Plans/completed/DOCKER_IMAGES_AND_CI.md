---
tags:
  - plan
  - tooling
  - deploy
status: completed
created: 2026-09-13
completed_on: 2026-09-13
---
# Plan: Ship container images for web/ and service/, built in CI

## Context
The repo is one npm workspace with three packages (`schema/`, `web/`, `service/`) and a single
root lockfile. Today the only documented way to run it is two `npm run dev:*` shells on a host
with Node 20.19+ ([README.md:129](../../README.md)). `schema/dist/` is generated and gitignored, so any
image has to build it before either consumer can import `@okr-viewer/schema`. In dev, Vite's
proxy is what makes `/api` work from the browser ([web/vite.config.js:10](../../web/vite.config.js));
a production `vite build` emits static files with no proxy at all, so that wiring has to be
re-created in the web image.

Two wrinkles the build must handle:
- `json-schema-to-typescript` is pinned to a GitHub fork and resolved in the lockfile as
  `git+ssh://git@github.com/...` ([package-lock.json:164](../../package-lock.json)). A container has no
  SSH key, so `npm ci` must rewrite that to HTTPS.
- `service/.env` holds `ANTHROPIC_API_KEY` and is gitignored. It must never enter an image layer.

## Goal
`docker build` in `web/` and in `service/` produces runnable images, and a GitHub Actions
workflow builds both on every push and PR.

## Decisions (locked in)
1. **Build context is the repo root, Dockerfiles live in the packages.** The workspace lockfile
   and `schema/` sit above both packages; a package-local context cannot see them. `-f
   service/Dockerfile .` keeps the file where the user asked for it.
2. **nginx serves the web image, and proxies `/api/`.** The production counterpart to Vite's dev
   proxy. Upstream comes from `$SERVICE_URL` through nginx's own template/envsubst entrypoint, so
   one image works in compose, on a LAN, or behind a gateway.
3. **Multi-stage, with a second production install rather than `npm prune`.** Pruning a workspace
   root leaves the other workspace's deps behind (three.js in a service image). A clean
   `npm ci --omit=dev --workspace <pkg>` in the runtime stage installs only what that package
   needs at runtime.
4. **`git config --global url."https://github.com/".insteadOf git+ssh://git@github.com/`** in
   every stage that installs. The fork is public over HTTPS at the exact commit the lockfile
   pins.
5. **CI builds both images always; pushes to GHCR only on `main` and tags.** A PR gets the build
   as a check without publishing anything.
6. **No secrets at build time.** `ANTHROPIC_API_KEY` is a runtime env var on the service
   container only.

## Phase 1 — Service image
`service/Dockerfile`, build stage installs the full workspace and runs `npm run build:schema`;
runtime stage does a prod-only install for `okr-viewer-service`, copies built `schema/`, runs as
the `node` user, exposes 8787, healthchecks `/api/health`
([service/index.js:15](../../service/index.js)).

## Phase 2 — Web image
`web/Dockerfile`, same build stage plus `npm run build -w web`; runtime is `nginx:alpine` with
`web/nginx.conf.template` — SPA fallback, `/api/` → `${SERVICE_URL}`, gzip, hashed-asset caching.

## Phase 3 — Compose + ignore file
Root `.dockerignore` (node_modules, dist, `.env`, `.git`) and a `docker-compose.yml` that wires
web → service so the pair is runnable in one command.

## Phase 4 — GitHub Actions
`.github/workflows/docker.yml`: a matrix over the two images using buildx, GHA layer cache and
`docker/metadata-action`; `push: ${{ github.event_name == 'push' }}` to GHCR.

## Verification
- `docker build -f service/Dockerfile .` and `-f web/Dockerfile .` both succeed from a clean tree.
- `docker compose up` → `curl localhost:8080/` serves the app, `curl localhost:8080/api/health`
  returns `{"ok":true,...}` through the nginx proxy.
- `docker run --rm <service> node -e "..."` confirms `@okr-viewer/schema` resolves and its `dist/`
  validators are present.
- No `.env` and no `web/` deps inside the service image.
- `actionlint` (or a workflow parse) over the new YAML.

## Out of scope
Publishing to any registry other than GHCR; deploy manifests (k8s/ECS); a dev container for the
`npm run dev:*` loop; multi-arch builds beyond amd64.

## Completion notes
- **Planned vs. actual.** All four phases landed as written. The two wrinkles called out in
  Context were both real and both fixed as designed: the `git+ssh://` → HTTPS rewrite
  ([service/Dockerfile:20](../../service/Dockerfile), [web/Dockerfile:23](../../web/Dockerfile)), and
  `.dockerignore` keeping `service/.env` out. The runtime image holds 8 root packages and none of
  web/'s — Decision 3 (prod install over `npm prune`) earned its keep.
- **Mid-flight adjustments.** One: Alpine does not work for the web build. Vite 8 builds through
  rolldown, and `package-lock.json` was resolved on linux/x64/glibc, so the only native binding in
  it is `@rolldown/binding-linux-x64-gnu` — no musl entry exists to install, and `vite build` dies
  with "Cannot find native binding". `web/Dockerfile` moved to `node:24-bookworm-slim`; the service
  image stayed on Alpine, where nothing native is involved. Same pin is why CI sets
  `platforms: linux/amd64`. Two: compose's `${VAR:?err}` is interpolated at parse time from the
  shell, not from `env_file`, so it failed even when `service/.env` held the key; the key is now a
  valueless `- ANTHROPIC_API_KEY` passthrough that never clobbers what `env_file` read.
- **Follow-up, same day: the wrong-context error was unusable.** Building from inside `service/`
  failed with `failed to compute cache key ... "/service/validate.js": not found` — naming a file
  that is sitting right there, and saying nothing about the actual mistake. The cause is that
  BuildKit resolves every context COPY in a Dockerfile eagerly and in parallel, so when several
  can fail it reports an arbitrary one. Neither ordering the COPYs nor gating stages on a
  bind-mount guard stage fixed it; both lost the race, verified. The fix is structural: a single
  `ctx` stage (`FROM busybox` + `COPY . /ctx`) is now the *only* reader of the build context, it
  checks for `package-lock.json` and `schema/`, and it prints the right command. Every other stage
  pulls named paths `--from=ctx` or `--from=build`. One context read cannot be raced, so the guard
  always wins. **This costs nothing in layer caching** — measured: after a real content change to
  `service/index.js`, both `npm ci` layers stayed `CACHED` and only the source COPY reran, because
  BuildKit keys a `COPY --from` on the content of the paths named, not on the source stage's layer.
- **Follow-up: `SERVICE_URL` had a silent failure mode.** `location /api/` only passes the request
  URI through when `proxy_pass` carries no URI of its own; any path — a bare trailing slash counts
  — replaces the matched `/api/` prefix instead, so `http://service:8787/` sends `/health` to the
  service and gets a 404. Measured all four forms. Nothing outside shows it: nginx keeps serving
  the app and the healthcheck only asks for `/`, so the container stays green while chat is dead.
  `web/docker-entrypoint.d/10-check-service-url.sh` now refuses to start nginx on anything but a
  bare origin. `SERVICE_URL` in compose also became overridable (`${SERVICE_URL:-...}`).
- **Surprises / residual risks.** Verified end to end against the running pair: `GET /` 200,
  SPA fallback 200 on an unknown path, `GET /api/health` → `{"ok":true,...}` and a `POST
  /api/chat` 400 (schema errors) both through the nginx proxy, gzip on, one `Cache-Control` per
  asset. Images are 64MB (web) / 183MB (service) from a cold cache. The live risk is the
  lockfile's platform coupling: **an arm64 build will fail at `vite build`**, so a contributor on
  Apple silicon needs `--platform linux/amd64` (or a regenerated lockfile) until someone widens
  it. Second, the base tags float on minor (`24-alpine`, `1.29-alpine`) — reproducible enough for
  CI, not digest-pinned.
