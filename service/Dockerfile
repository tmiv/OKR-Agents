# syntax=docker/dockerfile:1
#
# The build context is the REPO ROOT, not this directory:
#
#   docker build -f service/Dockerfile -t okr-agents-service .
#
# There is one lockfile for all three workspace packages, and service/ imports
# @okr-agents/schema, so neither is visible from a service/-scoped context.
#
# The `ctx` stage below is the ONLY thing that reads the build context, and that
# is load-bearing. BuildKit resolves every context COPY in a Dockerfile eagerly
# and in parallel, so when several of them can fail it reports an arbitrary one
# — which is how a build run from inside service/ ends up insisting that
# service/validate.js is missing while the file sits right there. One context
# read cannot be raced, so the error below is the one you actually get.

ARG NODE_VERSION=24-alpine

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
      echo "  three workspaces, and service/ imports @okr-agents/schema, so"; \
      echo "  neither is reachable from a service/-scoped context."; \
      echo; \
      echo "      docker build -f service/Dockerfile -t okr-agents-service ."; \
      echo; \
      exit 1; \
    fi

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
COPY --from=ctx /ctx/package.json /ctx/package-lock.json ./
COPY --from=ctx /ctx/web/package.json web/
COPY --from=ctx /ctx/service/package.json service/
# schema/ builds itself from its own `prepare` script during install, so its
# sources must land before npm ci rather than after.
COPY --from=ctx /ctx/schema schema
RUN npm ci

COPY --from=ctx /ctx/service/index.js /ctx/service/prompt.js /ctx/service/validate.js service/

# ── runtime ───────────────────────────────────────────────────────────────────
# A second, production-only install rather than pruning the build stage: this is
# a workspace root, and `npm prune` there would leave web/'s three.js and svelte
# sitting in an image that never serves a browser.
#
# Everything here comes --from=build, never from the context — see the header.
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/web/package.json web/
COPY --from=build /app/service/package.json service/
COPY --from=build /app/schema/package.json schema/
# --ignore-scripts: schema/'s `prepare` would try to rebuild dist/ with devDeps
# that this stage deliberately does not install. The built dist/ is copied in
# from the build stage instead.
RUN npm ci --omit=dev --ignore-scripts --workspace okr-agents-service \
 && npm cache clean --force

COPY --from=build /app/schema/dist schema/dist
COPY --from=build /app/schema/index.js /app/schema/index.d.ts /app/schema/version.js schema/
COPY --from=build /app/schema/migrations schema/migrations
COPY --from=build /app/service/index.js /app/service/prompt.js /app/service/validate.js service/

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
