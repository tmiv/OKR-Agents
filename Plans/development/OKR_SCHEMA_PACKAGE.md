---
tags:
  - plan
  - schema
  - tooling
  - web
  - service
status: development
created: 2026-09-11
---
# Plan: Add a versioned `@okr-viewer/schema` package shared by web and service

## TL;DR

Turn the repo into an npm workspace and add a `schema/` package that owns draft-07 JSON Schemas for the OKR node, tree, company structure, history (metric samples and tree changes), actions, the `/api/chat` request/response, and a versioned export document. Its build compiles TypeScript types with the `LudaThomas/json-schema-to-typescript#release` fork and precompiled Ajv validators; `service/` uses it to validate every request and to source the Claude tool schema, `web/` uses it to validate responses and to add Export/Import of the tree as a `schemaVersion`-stamped JSON file. History is schema-only for now; no TypeScript conversion of the consumers.

## Context

The OKR tree shape is defined four times by hand and nowhere formally:

- the README "Node shape" prose,
- `web/src/lib/tree.js:8` (the hand-written data) and `web/src/lib/apply.js:6` (`EDITABLE` field list, `clamp01` at `:8`, add-defaults at `:49-62`),
- `service/validate.js:5-7` (`LEVELS`, `TEXT_FIELDS`, `MAX_TEXT`) and `validateTree` at `:9-19`, which only checks "nodes is an array of unique string ids",
- `service/prompt.js:8-39` (`RESPOND_TOOL.input_schema`, already a JSON Schema, with `fields: { type: 'object' }` left untyped).

The tree lives only in browser memory and resets on reload (README "Scope boundary"). The next things we want, save/load and import/export of the tree, company structure data, and later a history of key result metrics and tree changes, all need one authoritative, versioned description of the data that both sides validate against. Neither package is TypeScript, so the types must arrive as generated `.d.ts` that plain JS consumers can use through JSDoc.

Tooling constraint: host Node is v12; every `npm`/`node` command runs inside the `dev` container (`docker exec -w /src dev …`, `/src` = repo root, Node 24.4 / npm 11.4). Verified 2026-09-11 that the container has git 2.39 and that `npm i github:LudaThomas/json-schema-to-typescript#release` installs 15.0.3 with a committed `dist/` (no build step) and `json2ts` runs.

## Goal

A `schema/` workspace package, `@okr-viewer/schema@0.1.0`, that owns the JSON Schemas for the OKR document, builds TypeScript types with the `LudaThomas/json-schema-to-typescript#release` fork and precompiled Ajv validators, and is imported by both `service/` and `web/` to validate every tree that crosses a boundary and to import/export the tree as a versioned JSON document.

## Decisions (locked in)

1. **npm workspaces at the repo root**, packages `schema`, `web`, `service`. One root lockfile replaces `web/package-lock.json` and `service/package-lock.json`. Consumers depend on `"@okr-viewer/schema": "^0.1.0"`; npm symlinks the workspace, so the package is versioned by its own `package.json` and `npm pack -w schema` produces an installable tarball if a consumer ever needs to pin an older build. No private registry.
2. **Compiler is the fork, pinned to the branch:** `"json-schema-to-typescript": "github:LudaThomas/json-schema-to-typescript#release"`. It is upstream 15.0.3 plus a fix that keeps a `$ref` with `title`/`description` siblings as a *named* reference instead of inlining and suffixing duplicates (`OkrNode1`), including across externally loaded files. Our schemas are multi-file and annotate every `$ref`, so upstream would produce duplicate types. Commit the `package-lock.json` so the resolved commit is pinned; bump by re-running `npm update json-schema-to-typescript -w schema`.
3. **JSON Schema draft-07**, `definitions` not `$defs`, one file per concept, every file has an `$id` under `https://okr-viewer.dev/schema/v1/`. Draft-07 is the draft both the fork and Ajv's default class support without flags.
4. **Ajv 8 validators are precompiled at build time** (`ajv/dist/standalone`, ESM output) into `schema/dist/validators.js`. Consumers never run Ajv's compiler: no `new Function` in the browser, smaller bundle, identical behaviour on both sides. `ajv` and `ajv-formats` stay runtime deps because standalone code imports their small runtime helpers.
5. **Document envelope with an integer `schemaVersion`.** Export/import moves an `OkrDocument` `{ schemaVersion: 1, meta, company?, tree, history? }`. The `/api/chat` contract keeps sending the bare `tree: { nodes }` (README: "one shape, don't add a second one"). Breaking schema changes bump `schemaVersion` and the package major; additive changes bump the minor. A `migrations/` folder holds one function per major step (empty at v1).
6. **Structural vs. semantic validation split.** JSON Schema covers shape only. Uniqueness of ids, parent existence, cycles, exactly one `company` root, are checked by a hand-written `checkTreeSemantics()` shipped in the same package and used by both sides. The level ladder (`kr → objective → company`) is reported as a *warning*, not an error, because `validateResponse` and `apply.js` allow free relinking today.
7. **`schema/dist/` is not committed.** The root `.gitignore` already ignores `dist/`. A `prepare` script builds it on `npm install`; npm runs `prepare` for workspace packages.
8. **History is schema-only in this plan.** `history.schema.json` is authored and referenced from the document so the envelope is stable, but nothing produces history yet.

## Phase 1 — Workspace scaffolding

1. Add root `package.json`: `{ "name": "okr-viewer", "private": true, "workspaces": ["schema", "web", "service"], "scripts": { "build:schema": "npm run build -w schema", "test:schema": "npm test -w schema", "dev:web": "npm run dev -w web", "dev:service": "npm run dev -w service" } }`.
2. Delete `web/package-lock.json` and `service/package-lock.json`; run `docker exec -w /src dev npm install` to produce the root lockfile. Confirm `web/vite.config.js:8-11` needs no `server.fs.allow` change (Vite detects the workspace root from the root `package.json`).
3. Add `schema/package.json`: name `@okr-viewer/schema`, version `0.1.0`, `"type": "module"`, `"exports": { ".": { "types": "./index.d.ts", "default": "./index.js" }, "./json/*": "./dist/json/*" }`, `"files": ["index.js", "index.d.ts", "src", "dist", "migrations"]`, scripts `build`, `prepare` (= build), `test` (`node --test test/`), `clean`. Deps: `ajv@^8.17`, `ajv-formats@^3`. DevDeps: the fork (Decision 2), `@apidevtools/json-schema-ref-parser@^11` (used for the tool schema in Phase 3), `typescript@^5` (only for `tsc --noEmit` over the generated types).
4. Add `"@okr-viewer/schema": "^0.1.0"` to `web/package.json` dependencies and `service/package.json` dependencies. Update the README "Setup" block: one `npm install` at the root, then the two `dev` scripts.

## Phase 2 — Author the schemas (`schema/src/`)

Every property carries a `description`; those descriptions are reused verbatim as the Claude tool's field descriptions in Phase 3, so write them for the model as well as for humans.

| File | Title / root type | Notes |
|---|---|---|
| `okr-node.schema.json` | `OkrNode` | `id` (string, `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`), `level` enum `company\|objective\|kr`, `parent` string or null, `label` (1–400 chars), `owner`, `metric`, `target` (0–400 chars, match `MAX_TEXT` at `service/validate.js:7`), `contributes` number 0–1. Required: `id, level, parent, label`. `additionalProperties: false` (tree nodes never carry graph `x/y/z`; `Graph.svelte:45-56` copies before mutating). |
| `okr-tree.schema.json` | `OkrTree` | `{ nodes: OkrNode[] }`, `maxItems: 500` (matches `service/validate.js:11`). No other properties. |
| `company.schema.json` | `Company` | `{ name, units: [{ id, name, parent: string\|null, lead? }], people?: [{ id, name, unitId }] }`. Node `owner` stays free text in v1; a `unitId` on nodes is a future additive change. |
| `history.schema.json` | `History` | `{ metricSamples: [{ nodeId, at (date-time), value (number), note? }], changes: [{ at, actor: 'user'\|'assistant'\|'import', reason?, actions: Action[] }] }`. Schema only (Decision 8). |
| `action.schema.json` | `Action` | `oneOf` by `op`: `edit`/`relink` (`fields` ⊆ `label, owner, metric, target, contributes, parent`), `add` (`fields` additionally `level`, `label` required), `delete` (no `fields`). Encodes the rules currently spread over `service/validate.js:42-55` and `web/src/lib/apply.js:6`. |
| `chat-request.schema.json` | `ChatRequest` | `{ tree: OkrTree, message (1–4000), selectedNodeId: string\|null, history: [{ role, content }] (max 50) }`. |
| `chat-response.schema.json` | `ChatResponse` | `{ reply, actions: Action[], highlight: string[] }`. Also the tool's input shape. |
| `okr-document.schema.json` | `OkrDocument` | Envelope from Decision 5. `meta`: `{ title?, period?, exportedAt (date-time), generator? }`. |
| `index.schema.json` | `OkrSchemaIndex` | Synthetic root whose properties `$ref` every file above, so one `json2ts` run emits every named type exactly once. Never validated against. |

Cross-file references use relative `$ref`s (`"$ref": "okr-node.schema.json"`) with a `description` sibling; this is the exact case the fork fixes.

## Phase 3 — Build pipeline (`schema/scripts/build.mjs`, plain Node ESM)

Steps, each failing the build loudly:

1. **Meta-validate**: load every `src/*.schema.json`, `ajv.validateSchema()` each against draft-07, register all by `$id`.
2. **Types**: `compileFromFile('src/index.schema.json', { cwd: 'src', declareExternallyReferenced: true, additionalProperties: false, bannerComment: <generated-by note naming the fork>, style: { singleQuote: true, semi: true, printWidth: 120 } })` → `dist/types.d.ts`. Fail if the output contains `/\b\w+\d+\b/`-style suffixed duplicates (`OkrNode1`), which is the regression the fork exists to prevent.
3. **Validators**: `new Ajv({ allErrors: true, strict: true, code: { source: true, esm: true } })` + `addFormats`; `standaloneCode(ajv, { validateOkrDocument: '<id>', validateOkrTree, validateOkrNode, validateCompany, validateHistory, validateAction, validateChatRequest, validateChatResponse })` → `dist/validators.js`; write a matching `dist/validators.d.ts` (each export is `(data: unknown) => boolean` with an `errors` property).
4. **Copies**: `src/*.schema.json` → `dist/json/`.
5. **Tool schema**: `$RefParser.dereference('src/chat-response.schema.json')`, delete `$schema`, `$id`, `definitions`, add `required: ['reply','actions','highlight']` → `dist/json/tool/respond-input.json`. Claude's `input_schema` cannot follow external `$ref`s, so it gets the flattened copy.
6. **Type-check**: `tsc --noEmit --strict dist/types.d.ts index.d.ts`.

Run with `docker exec -w /src dev npm run build:schema`.

## Phase 4 — Package runtime API (`schema/index.js`, `schema/index.d.ts`)

- `SCHEMA_VERSION = 1`, `PACKAGE_VERSION` (read from `package.json`).
- `validate<X>(data)` wrappers returning `{ ok: true, value }` or `{ ok: false, errors: string[] }` with Ajv errors rendered as `instancePath: message` (never expose raw Ajv error objects to callers).
- `checkTreeSemantics(tree)` → `{ errors: string[], warnings: string[] }` per Decision 6. Ports the id/duplicate logic from `service/validate.js:12-17` and the cycle walk from `web/src/lib/apply.js:28-32` into one place.
- `createDocument({ tree, company?, history?, meta? })` → stamped `OkrDocument` with `schemaVersion` and `exportedAt`.
- `parseDocument(text | object)` → `{ ok, document }` after: JSON parse, `schemaVersion` check (reject `> SCHEMA_VERSION`, migrate `<` via `migrations/`), `validateOkrDocument`, `checkTreeSemantics`.
- Re-export the JSON (`RESPOND_INPUT_SCHEMA`) and the generated types from `index.d.ts` (`export type { OkrNode, OkrTree, … } from './dist/types.js'`).
- `schema/test/*.test.js` using `node:test`: fixtures under `test/fixtures/{valid,invalid}/`, round-trip `createDocument → JSON → parseDocument`, `web/src/lib/tree.js` `initialTree` validates with zero warnings, `respond-input.json` contains no `$ref`, every invalid fixture fails with the expected `instancePath`.

## Phase 5 — Service adoption

1. `service/index.js:18-24`: replace the ad-hoc checks with `validateChatRequest(req.body)`; on failure respond `400 { error, details: errors }`. Then `checkTreeSemantics(tree)`; errors → 400, warnings → `console.warn`. Keep the `selected` resolution at `:26`.
2. `service/validate.js`: delete `validateTree` (`:9-19`), `LEVELS`/`TEXT_FIELDS`/`MAX_TEXT` (`:5-7`) and `cleanFields` (`:42-55`). Keep `sanitizeHistory`, `mergeTurns`, and `validateResponse`, but have `validateResponse` first run each action through `validateAction` and reject with `dropped.push({ action, reason })` on shape failure, then keep its existing id/parent/cycle referential checks (`:63-114`), which are tree-relative and belong here.
3. `service/prompt.js:8-39`: `RESPOND_TOOL.input_schema` becomes `RESPOND_INPUT_SCHEMA` imported from the package. Keep `name` and `description` here. The `## Actions` prose at `:62-67` stays; it explains intent, the schema now enforces shape.
4. Import path: `import { validateChatRequest, validateAction, checkTreeSemantics, RESPOND_INPUT_SCHEMA } from '@okr-viewer/schema'`.

## Phase 6 — Web adoption and import/export

1. `web/src/App.svelte:5-6`: import `validateChatResponse`, `createDocument`, `parseDocument`, `checkTreeSemantics`.
2. `web/src/App.svelte:37`: validate the response before `applyActions`; on failure push an error message instead of applying. In dev only (`import.meta.env.DEV`), assert `initialTree` at `:10` with `validateOkrTree` + `checkTreeSemantics` so a bad hand edit to `tree.js` fails at boot rather than mid-demo.
3. Add **Export** and **Import** buttons next to `:92-97`. Export: `createDocument({ tree, meta: { title: 'OKR Viewer export' } })` → Blob download `okr-<date>.json`. Import: hidden `<input type=file accept=.json>`, `parseDocument(await file.text())`; on success push the current tree onto `undoStack` (same pattern as `reset()` at `:59-64`) and replace `tree`; on failure surface the first three errors in the chat panel as an error message. Warnings are shown but do not block.
4. `web/src/lib/apply.js`: no behaviour change. Add JSDoc types (`/** @param {import('@okr-viewer/schema').OkrTree} tree */`) so editors pick up the generated types; same for `tree.js:8`.
5. Vite: because the package is a symlinked workspace, Vite treats it as source and pre-bundles its CJS deps on discovery. If the browser logs `does not provide an export named default` for an `ajv/dist/runtime/*` module, add those paths to `optimizeDeps.include` in `web/vite.config.js`.

## Verification

- `docker exec -w /src dev npm install` succeeds from a clean checkout with `schema/dist/` absent and leaves it built (Decision 7).
- `npm run build:schema` is idempotent and `dist/types.d.ts` contains each interface once (`grep -c 'export interface OkrNode' == 1`, no `OkrNode1`).
- `npm run test:schema` passes: fixtures, round-trip, `initialTree` clean, tool schema has no `$ref`.
- Service: `curl -X POST :8787/api/chat -d '{"tree":{"nodes":[{"id":1}]},"message":"hi"}'` → 400 whose `details` names `/tree/nodes/0/id`. A valid request still returns `{ reply, actions, highlight }`; a fabricated action with `op: "explode"` appears in the `[chat] dropped` log line.
- Web: run the 90-second demo script unchanged, then Export, Reset, Import the file, and confirm the edited tree and undo stack are back. Import a file with `schemaVersion: 2` and confirm a clear refusal.
- `git status` shows no `schema/dist/` and a single root `package-lock.json`.

## Out of scope

- Converting `web/` or `service/` to TypeScript. Types are consumed via JSDoc only.
- Producing history (recording metric samples or change logs). Schema only.
- Persisting anything server-side; the service stays stateless.
- Publishing the package to any registry; `npm pack` tarballs are the only "release" artefact.
- Referencing `owner` to `company.units` (future additive `unitId`).
- Prompt tuning beyond swapping in the shared tool schema.

## Risks / rollback

- **Git dependency drift.** `#release` is a moving branch. The lockfile pins the commit; a CI/clean install with a stale lock still resolves the same commit. If the fork disappears, vendor `dist/` from `node_modules` into `schema/vendor/` and point the dep at `file:vendor/json-schema-to-typescript`.
- **Stricter request validation could reject trees the UI already holds** (for example `contributes` missing on hand-written nodes). Mitigation: `contributes` is optional in the schema with `default: 0.5`, matching `apply.js:8`, and the dev-time assertion in Phase 6 step 2 catches drift before a demo.
- **Anthropic API rejecting the flattened tool schema.** `oneOf` on `Action` is supported by the tool-use JSON Schema subset, but if the API rejects it, fall back to the current loose `{ op, id, fields }` in `respond-input.json` while keeping strict validation server-side.
- **Rollback**: delete `schema/`, restore the two per-package lockfiles from git, revert the four touched files. No data formats ship until Phase 6, so nothing persisted needs migrating.

## Completion notes

*(fill in at completion)*
