# syntax=docker/dockerfile:1
#
# The build context is the REPO ROOT, not this directory:
#
#   docker build -f web/Dockerfile -t okr-viewer-web .
#
# There is one lockfile for all three workspace packages, and web/ imports
# @okr-viewer/schema, so neither is visible from a web/-scoped context.
#
# The `ctx` stage below is the ONLY thing that reads the build context, and that
# is load-bearing. BuildKit resolves every context COPY in a Dockerfile eagerly
# and in parallel, so when several of them can fail it reports an arbitrary one
# — a build run from inside web/ ends up insisting some file is missing while it
# sits right there. One context read cannot be raced, so the error below is the
# one you actually get.

# Debian, not Alpine: Vite 8 builds through rolldown, which loads a native
# binding, and the lockfile only resolves @rolldown/binding-linux-x64-gnu. There
# is no musl entry to install on Alpine, so the build dies at `vite build`. That
# same pin is why these images target linux/amd64.
ARG NODE_VERSION=24-bookworm-slim
ARG NGINX_VERSION=1.29-alpine

# ── context ───────────────────────────────────────────────────────────────────
# Takes the context whole (.dockerignore already trims it to source), checks it
# is the repo root, and hands named paths to the stages below. A COPY of a
# missing file just dies; having the files in hand lets us say what is wrong.
#
# Copying everything here does not cost the npm ci cache: the stages below pull
# named paths out of this one, and BuildKit keys those on the content of the
# paths named, not on this stage's layer.
FROM busybox:1.37 AS ctx
COPY . /ctx
RUN if [ ! -f /ctx/package-lock.json ] || [ ! -d /ctx/schema ]; then \
      echo; \
      echo "  Wrong build context: no package-lock.json and no schema/ in it."; \
      echo; \
      echo "  This image builds from the repo root. One lockfile covers all"; \
      echo "  three workspaces, and web/ imports @okr-viewer/schema, so"; \
      echo "  neither is reachable from a web/-scoped context."; \
      echo; \
      echo "      docker build -f web/Dockerfile -t okr-viewer-web ."; \
      echo; \
      exit 1; \
    fi

# ── build ─────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS build

# git, because the lockfile pins json-schema-to-typescript to a GitHub fork and
# records it as git+ssh://. A container has no SSH key; the fork is public over
# HTTPS at exactly the commit the lockfile names, so rewrite the transport.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/* \
 && git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/"

WORKDIR /app

# npm ci checks the lockfile against every workspace, so all three package.json
# files have to be present even though this image only builds one of them.
COPY --from=ctx /ctx/package.json /ctx/package-lock.json ./
COPY --from=ctx /ctx/web/package.json web/
COPY --from=ctx /ctx/service/package.json service/
# schema/ builds itself from its own `prepare` script during install, so its
# sources must land before npm ci rather than after.
COPY --from=ctx /ctx/schema schema
RUN npm ci

COPY --from=ctx /ctx/web web
RUN npm run build -w web

# ── runtime ───────────────────────────────────────────────────────────────────
# `vite build` emits static files with no dev server behind them, so the proxy
# that vite.config.js provides in development has to be rebuilt here. nginx does
# both jobs: serve the bundle, and forward /api/ to the service.
FROM nginx:${NGINX_VERSION} AS runtime

# Substituted into the config by nginx's entrypoint at container start.
# SERVICE_URL takes no trailing slash: with `location /api/` and a bare origin,
# nginx forwards the request path through unchanged.
ENV NGINX_PORT=8080
ENV SERVICE_URL=http://service:8787

# Checked before the template is rendered; see the script for why SERVICE_URL
# with a path silently breaks /api/. --chmod because nginx's entrypoint only
# runs docker-entrypoint.d/ scripts that are executable.
COPY --from=build --chmod=755 /app/web/docker-entrypoint.d/ /docker-entrypoint.d/

# default.conf.template renders over the image's own default.conf. Taken
# --from=build, not from the context — see the header.
COPY --from=build /app/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/web/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${NGINX_PORT}/" || exit 1
