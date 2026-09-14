# syntax=docker/dockerfile:1
#
# The build context is the REPO ROOT, not this directory:
#
#   docker build -f web/Dockerfile -t okr-viewer-web .
#
# There is one lockfile for all three workspace packages, and web/ imports
# @okr-viewer/schema, so neither is visible from a web/-scoped context.

# Debian, not Alpine: Vite 8 builds through rolldown, which loads a native
# binding, and the lockfile only resolves @rolldown/binding-linux-x64-gnu. There
# is no musl entry to install on Alpine, so the build dies at `vite build`. That
# same pin is why these images target linux/amd64.
ARG NODE_VERSION=24-bookworm-slim
ARG NGINX_VERSION=1.29-alpine

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
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY service/package.json service/
# schema/ builds itself from its own `prepare` script during install, so its
# sources must land before npm ci rather than after.
COPY schema/ schema/
RUN npm ci

COPY web/ web/
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

# default.conf.template renders over the image's own default.conf.
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/web/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${NGINX_PORT}/" || exit 1
