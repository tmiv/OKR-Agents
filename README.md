# OKR Viewer

A 3D OKR tree you can interrogate and edit by talking to it.

Load an org's objectives and key results as a navigable 3D graph, then ask questions in plain language — "which KRs don't ladder up to anything?", "make the marketing KRs measurable" — and watch Claude answer *by moving the visualization*: flying the camera to the nodes it's talking about, and rewriting them in place when you ask it to.

The pitch in one line: **the model's output is the interface, not a chat log next to one.**

---

## Demo script

This is the thing to build toward. Everything below serves these 90 seconds.

1. **Open on the full tree.** One company objective at the top, team objectives beneath it, KRs at the leaves. Rotate it. It's obviously a hierarchy and you can see all of it at once.
2. **Ask a question.** "Which key results don't clearly support a company objective?" → Claude answers in the panel *and* three nodes pulse red while the camera flies to them.
3. **Ask for a fix.** "Rewrite those so they're measurable and tie them to the right objective." → the nodes' text changes, edges re-link, the graph settles into a new shape.
4. **Undo it.** One click, tree snaps back. (This also saves you if the model does something dumb on stage.)

---

## Architecture

```
┌──────────────────────┐         ┌─────────────────────┐         ┌────────┐
│  web/  (Vite+Svelte) │  POST   │  service/ (Express) │  HTTPS  │ Claude │
│                      │ /api/   │                     │         │  API   │
│  owns the tree ──────┼─ chat ──┼─> owns the prompt    ├────────>│        │
│  renders the graph   │<────────┼── + tool schema      │<────────┤        │
│  applies actions     │ {reply, │   validates IDs      │         └────────┘
│  keeps undo stack    │  actions│                      │
└──────────────────────┘  highlight}────────────────────┘
```

**The service is stateless.** The browser owns the tree and sends it along with every message. No session store, no database, no drift between what the service thinks the tree is and what's on screen.

**The service owns the system prompt and the tool schema.** The frontend never constructs a prompt. This means prompt iteration — which is most of your tuning time — is a service-only change.

---

## The contract

One endpoint. One shape. Don't add a second one.

```
POST /api/chat
{
  "tree":           { "nodes": [...] },     // the whole thing, every time
  "message":        "make the marketing KRs measurable",
  "selectedNodeId": "kr-7" | null,          // what the user clicked, for context
  "history":        [{ "role": "user"|"assistant", "content": "..." }]
}

→ 200
{
  "reply":     "I tightened three KRs under Marketing…",
  "actions":   [{ "op": "edit", "id": "kr-7", "fields": { "label": "…" } }],
  "highlight": ["kr-7", "kr-8", "kr-9"]
}
```

`actions` is often empty — most messages are questions, not edits. `highlight` is almost never empty, and it's what makes the thing feel alive.

### Node shape

Keep it flat. A flat array with `parent` pointers is easier to mutate than nested children, and `3d-force-graph` wants flat nodes and links anyway.

```js
{
  id:          'kr-7',
  level:       'company' | 'objective' | 'kr',
  parent:      'obj-2' | null,
  label:       'Reduce time-to-first-value for new accounts',
  owner:       'Marketing',
  metric:      'median days from signup to first workflow run',
  target:      '14 → 5 by Q4',
  contributes: 0.8            // 0–1, how well this supports its parent
}
```

`contributes` is the field that earns the visualization. Edge thickness and color come from it, and low-scoring links are the "misalignment" the demo finds. Hand-author these values — it's a demo, and a hand-tuned tree demos better than a realistic one.

---

## The one-tool trick

Do **not** define `edit_node`, `add_node`, `relink_node`, and `highlight_nodes` as four separate tools. Real multi-tool use means Claude stops at the `tool_use` block, you send back a `tool_result`, and you make a second call to get the final text — two round trips, continuation logic, and a branch for "what if it called no tools at all."

Instead: **one tool, forced.**

```js
const RESPOND_TOOL = {
  name: 'respond',
  description: 'Reply to the user about their OKR tree. Always call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'Your answer, shown in the chat panel. Conversational, 1-3 sentences.'
      },
      actions: {
        type: 'array',
        description: 'Edits to apply to the tree. Empty array if the user only asked a question.',
        items: {
          type: 'object',
          properties: {
            op:     { type: 'string', enum: ['edit', 'add', 'relink', 'delete'] },
            id:     { type: 'string' },
            fields: { type: 'object' }
          },
          required: ['op', 'id']
        }
      },
      highlight: {
        type: 'array',
        description: 'IDs of nodes your reply refers to. The camera flies to these. Use generously.',
        items: { type: 'string' }
      }
    },
    required: ['reply', 'actions', 'highlight']
  }
};
```

Called with `tool_choice: { type: 'tool', name: 'respond' }`. Guaranteed structured output, single call, zero branching.

---

## Setup

It boots on a bundled dataset and ships five of them, switchable from the top
bar. The default, **Babylon.js, an illustrative 9.x cycle**, is the one that is
not a company: an open-source monorepo whose sub-libraries — core, loaders, the
node editors, the playground, the MCP servers — are the teams, each with a
charter saying what it owns and which of the others it depends on. One of them,
Issue triage, is the first team here whose charter reads as a job an agent could
be handed tomorrow. The package layout is real; **the OKRs and every number in
the file are invented**, and nothing in it is a statement about the real
project's plans or health.

Requires Node 20.19+ (Vite 8 and Express 5 both need it).

The repo is one npm workspace with three packages, so there is a single install
at the root and a single lockfile. Installing also builds `schema/` (its
`prepare` script), which both other packages import.

```bash
git clone <repo> && cd okr-viewer
npm install                                   # installs all three, builds schema/
cp service/.env.example service/.env          # add ANTHROPIC_API_KEY

npm run dev:service                           # :8787
npm run dev:web                               # :5173, in a second shell
```

Other root scripts: `npm run build:schema` after editing anything in
`schema/src/`, and `npm run test:schema` to run the schema's own tests.

`vite.config.js` proxies `/api` → `:8787`, so there's no CORS to fight in dev:

```js
server: { proxy: { '/api': 'http://localhost:8787' } }
```

The key lives only in `service/.env` and never reaches the browser. `.env` is gitignored — check that before your first commit, not after.

Model ID goes in one place (`service/prompt.js`). Check <https://docs.claude.com/en/docs/about-claude/models> for the current Sonnet-class ID rather than trusting a hardcoded string from a template.

---

## Containers

`web/` and `service/` each ship a Dockerfile, plus a `docker-compose.yml` that
wires them together:

```bash
cp service/.env.example service/.env          # add ANTHROPIC_API_KEY
docker compose up --build                     # → http://localhost:8080
```

**Both images build from the repo root**, even though the Dockerfiles live in
their packages — there is one lockfile for all three workspaces, and both
packages import `@okr-viewer/schema`, so a package-scoped context cannot see
what it needs:

```bash
docker build -f service/Dockerfile -t okr-viewer-service .
docker build -f web/Dockerfile     -t okr-viewer-web     .
```

| | Base | Port | Env |
|---|---|---|---|
| `service` | `node:24-alpine`, non-root, `/api/health` healthcheck | 8787 | `ANTHROPIC_API_KEY`, `APP_ORIGIN`, `PORT` |
| `web` | `nginx:1.29-alpine` over a `vite build` | 8080 | `SERVICE_URL`, `NGINX_PORT` |

Each container names the other's host in its own environment: `SERVICE_URL` tells
the web container where to proxy `/api/`, and `APP_ORIGIN` tells the service
which browser origin is allowed to call it.

### SERVICE_URL is an origin, not a URL with a path

`scheme://host[:port]` and nothing more — no path, not even a trailing slash.
`location /api/` passes the request URI through *only* when `proxy_pass` has no
URI part of its own; give it one and nginx substitutes it for the matched
`/api/` prefix instead:

| `SERVICE_URL` | service receives | |
|---|---|---|
| `http://service:8787` | `/api/health` | correct |
| `http://service:8787/` | `/health` | 404 |
| `http://service:8787/api` | `/apihealth` | 404 |
| `http://service:8787/api/` | `/api/health` | works, by coincidence |

That mistake is invisible from outside — nginx still serves the app, and the web
container's healthcheck only asks for `/`, so it stays green while every chat
turn 404s. So `web/docker-entrypoint.d/10-check-service-url.sh` refuses to start
nginx on anything but a bare origin, and prints why.

The web image is what replaces the dev proxy. `vite build` emits static files
with no dev server behind them, so nginx does both jobs: serve the bundle, and
forward `/api/` to `$SERVICE_URL` (no trailing slash — `web/nginx.conf.template`
passes the path through unchanged). The browser still only ever talks to one
origin, so there is no CORS to configure and the key never reaches a bundle.

### CORS

`APP_ORIGIN` is the list of browser origins the service will answer. Through the
proxy it is the app's own URL — `http://localhost:8080` with the compose stack,
your real domain in production:

```bash
APP_ORIGIN=https://okr.example.com        # comma-separated for several
APP_ORIGIN='*'                            # explicit opt-out
```

It must be a full **origin** — `scheme://host[:port]` — because that is what the
browser sends and what CORS compares. A bare hostname matches nothing.

The rules, and why:

- **No `Origin` header → allowed.** Same-origin GETs, the container healthcheck
  and every server-side caller send none. Refusing them would break the
  healthcheck and protect nobody.
- **An unlisted `Origin` → 403**, before the handler runs. Merely omitting
  `Access-Control-Allow-Origin` would make the browser discard the *response*,
  but the request has already cost tokens by then.
- **Unset → `http://localhost:5173`**, the Vite dev origin, so `npm run dev:*`
  needs no extra setup.

The allowlist is printed in the service's boot line, because the failure it
causes is quiet: `/api/health` sends no `Origin` and stays green while every
chat turn 403s. Every refusal logs the origin it refused.

This is defence in depth, not the primary boundary — with the proxy the browser
is same-origin anyway. It matters the moment the service port is reachable from
a browser: the commented-out `ports:` block in `docker-compose.yml`, a compose
override, a LAN deploy. CORS stops a page on another origin; it does not stop a
script with curl, which is why the service port stays unpublished by default.

Two build constraints worth knowing before you change a base image:

- **The images target `linux/amd64`.** `package-lock.json` was resolved on
  linux/x64/glibc, so `@rolldown/binding-linux-x64-gnu` is the only Vite 8
  native binding in it. That is why `web/Dockerfile` builds on Debian rather
  than Alpine, and why widening `platforms:` in CI means regenerating the
  lockfile first.
- **Both build stages install `git` and rewrite `git+ssh://` to HTTPS.** The
  lockfile pins `json-schema-to-typescript` to a public GitHub fork but records
  an SSH URL, and a container has no key.

`ANTHROPIC_API_KEY` is a runtime variable on the service container only, never a
build arg — a build arg stays readable in the image history. `.dockerignore`
keeps `service/.env` out of the build context entirely.

[.github/workflows/docker.yml](.github/workflows/docker.yml) builds both images
on every push and PR, publishes them to GHCR from `main` and `v*` tags, and
smoke-tests the pair with `docker compose` — `GET /` and `GET /api/health`
through the proxy.



---

## Layout

```
okr-viewer/
├── package.json                npm workspace root; one lockfile for all three
├── docker-compose.yml          web → service, the pair in one command
├── .dockerignore               build context for both images (keeps .env out)
├── schema/                     @okr-viewer/schema — the shape, owned in one place
│   ├── src/*.schema.json       draft-07 schemas: node, tree, company, history,
│   │                           action, chat request/response, document envelope
│   ├── scripts/build.mjs       → dist/types.d.ts, dist/validators.js, tool schema
│   ├── index.js                validate*(), checkTreeSemantics(), create/parseDocument
│   ├── version.js              SCHEMA_VERSION, the document format version
│   ├── migrations/             one function per major step (empty at v1)
│   └── test/                   fixtures + round-trip tests
├── web/
│   ├── Dockerfile              vite build → nginx (serves the bundle, proxies /api/)
│   ├── nginx.conf.template     SPA fallback + ${SERVICE_URL}, rendered at start
│   ├── docker-entrypoint.d/    rejects a SERVICE_URL with a path, before nginx starts
│   ├── src/
│   │   ├── App.svelte          layout, owns tree state + undo stack, export/import
│   │   ├── Graph.svelte        3d-force-graph, bind:this + onMount
│   │   ├── Chat.svelte         message list, input, loading state
│   │   ├── Detail.svelte       selected-node sidebar
│   │   ├── assets/datasets/    hand-written OkrDocument JSON + manifest.json
│   │   ├── lib/datasets.js     bundles them, validates them, picks the default
│   │   └── lib/apply.js        applyAction(tree, action) → new tree
│   └── vite.config.js
└── service/
    ├── Dockerfile              workspace install → schema build → prod-only runtime
    ├── index.js                POST /api/chat, CORS gate on $APP_ORIGIN
    ├── prompt.js               system prompt + RESPOND_TOOL
    └── validate.js             drop actions/highlights with unknown IDs
```

`schema/dist/` is generated and gitignored. Edit `schema/src/`, run
`npm run build:schema`, and both consumers pick the change up.

---

## Build order

Each step is shippable on its own. If the clock runs out, you stop at a checkpoint with something that demos — not a half-wired step 4.

| # | Step | Est. | If you stop here |
|---|------|------|------------------|
| 1 | Hand-write `assets/datasets/*.json`, load via `lib/datasets.js`, render with `3d-force-graph` (`dagMode: 'td'`), click → camera + detail panel | 50m | A working 3D OKR browser |
| 2 | Chat panel → `/api/chat`, whole tree in the system prompt, Claude answers questions | 30m | "Ask your OKRs anything" — already demoable |
| 3 | Honor `highlight[]`: camera fly-to + pulse | 20m | **The wow.** Answers move the view |
| 4 | Honor `actions[]`: apply, re-render, push undo snapshot | 40m | The full pitch |

**Protect steps 3 and 4 by keeping step 1 dumb.** Hand-author the JSON. No importer, no file upload, no editor UI. Twenty-five nodes is plenty and fits in a prompt with room to spare.

Stretch, only if you're ahead: highlight-by-hover on chat text, a `contributes` threshold slider, export the edited tree as JSON.

---

## Things that will bite you

**Claude will invent node IDs.** Not often, but it will, and an unknown ID either throws in your renderer or silently no-ops in the middle of a demo. You have the tree right there in the request — filter `actions` and `highlight` against it server-side and drop what doesn't resolve. Ten minutes of work on the single most likely live failure.

**Keep the graph instance out of Svelte's reactive system.** `3d-force-graph` mutates its own internals and does its own render loop; it fights `$state` if you let it. Create it once in `onMount` into a plain `let graph`, and push updates imperatively:

```js
$effect(() => { graph?.graphData(toGraphData(tree)); });
```

**Don't stream.** ~2k tokens in, a few hundred out — that's 2–4 seconds. A spinner is fine. Streaming tool-use blocks is fiddly enough to eat a meaningful slice of a two-hour budget for no demo value.

**Snapshot before you mutate.** `undoStack.push(structuredClone(tree))` before applying actions. Five lines, one button, and it turns a bad model response during a live demo from a dead end into "watch, I'll just back that out."

**Re-heating the layout on every edit is jarring.** After applying actions, prefer updating node objects in place over replacing the whole dataset, or the force simulation reshuffles the entire tree and the viewer loses their place.

---

## Scope boundary

Explicitly out for v1, listed here so it stays out:

- Auth, multi-user, persistence — the tree lives in memory and resets on reload
- Importing real OKRs from anywhere
- Streaming responses
- Mobile layout
- Tests
