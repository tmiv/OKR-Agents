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

## Layout

```
okr-viewer/
├── package.json                npm workspace root; one lockfile for all three
├── schema/                     @okr-viewer/schema — the shape, owned in one place
│   ├── src/*.schema.json       draft-07 schemas: node, tree, company, history,
│   │                           action, chat request/response, document envelope
│   ├── scripts/build.mjs       → dist/types.d.ts, dist/validators.js, tool schema
│   ├── index.js                validate*(), checkTreeSemantics(), create/parseDocument
│   ├── version.js              SCHEMA_VERSION, the document format version
│   ├── migrations/             one function per major step (empty at v1)
│   └── test/                   fixtures + round-trip tests
├── web/
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
    ├── index.js                POST /api/chat
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
