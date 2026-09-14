# syntax=docker/dockerfile:1
#
# The build context is the REPO ROOT, not this directory:
#
#   docker build -f service/Dockerfile -t okr-viewer-service .
#
# There is one lockfile for all three workspace packages, and service/ imports
# @okr-viewer/schema, so neither is visible from a service/-scoped context.

ARG NODE_VERSION=24-alpine

# ── build ─────────────────────────────────────────────────────────────────────
# Installs the whole workspace so schema/ can generate dist/ (its validators and
# types are gitignored, and both consumers import them).
FROM node:${NODE_VERSION} AS build

# git, because the lockfile pins json-schema-to-typescript to a GitHub fork and
# records it as git+ssh://. A container has no SSH key; the fork is public over
# HTTPS at exactly the commit the lockfile names, so rewrite the transport.
RUN apk add --no-cache git \
 && git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/"

WORKDIR /app

# npm ci checks the lockfile against every workspace, so all three package.json
# files have to be present even though this image only runs one of them.
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY service/package.json service/
# schema/ builds itself from its own `prepare` script during install, so its
# sources must land before npm ci rather than after.
COPY schema/ schema/
RUN npm ci

# ── runtime ───────────────────────────────────────────────────────────────────
# A second, production-only install rather than pruning the build stage: this is
# a workspace root, and `npm prune` there would leave web/'s three.js and svelte
# sitting in an image that never serves a browser.
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY web/package.json web/
COPY service/package.json service/
COPY schema/package.json schema/
# --ignore-scripts: schema/'s `prepare` would try to rebuild dist/ with devDeps
# that this stage deliberately does not install. The built dist/ is copied in
# from the build stage instead.
RUN npm ci --omit=dev --ignore-scripts --workspace okr-viewer-service \
 && npm cache clean --force

COPY --from=build /app/schema/dist schema/dist
COPY schema/index.js schema/index.d.ts schema/version.js schema/
COPY schema/migrations schema/migrations
COPY service/index.js service/prompt.js service/validate.js service/

# ANTHROPIC_API_KEY is a runtime variable, never a build arg — a build arg would
# be readable in the image history. service/.env stays out via .dockerignore;
# dotenv simply finds no file and process.env wins.
ENV PORT=8787
EXPOSE 8787

USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/service
CMD ["node", "index.js"]
