---
tags:
  - plan
  - web
  - data
status: completed
created: 2026-09-11
completed_on: 2026-09-11
predecessors:
  - completed/OKR_SCHEMA_PACKAGE.md
---
# Plan: Ship the default graph and alternates as bundled OkrDocument JSON datasets

Concept: [OKR Agents - Product Vision](../../Concepts/OKR%20Agents%20-%20Product%20Vision.md)
(invariant 4: "the document is the unit of truth").

## Context

Today the only data is `web/src/lib/tree.js:9`, a hand-written JS object exported as
`initialTree`. `web/src/App.svelte:5` imports it, `:21` clones it into state, `:81` resets to
it, and `schema/test/document.test.js:7` imports it as a fixture. The schema package already
defines the file format we want (`OkrDocument`; `parseDocument` at `schema/index.js:261`), and
Export/Import (`App.svelte:94-129`) already speak it. The default data should be one of several
documents in that format, so a demo can pick the tree that fits the audience, and so later plans
(teams, history) can ship their data in the same files.

## Goal

The app boots from `web/src/assets/datasets/*.json`, each a valid `OkrDocument`, with a topbar
picker to switch between them; `tree.js` is gone.

## Decisions (locked in)

1. **Datasets are OkrDocuments, not bare trees.** Same envelope as Export/Import, so a bundled
   file and an exported file are interchangeable, and `company` / `history` can be added to a
   dataset later without a new format. `meta.exportedAt` is a fixed string; `meta.generator` is
   `"hand-authored"`.
2. **Bundled at build time via `import.meta.glob`, not fetched from `public/`.** Vite inlines
   JSON; every dataset is validated at boot in dev (the check at `App.svelte:11-17` today) so a
   bad hand edit fails loudly. No runtime fetch, no loading state, no 404 path.
3. **A manifest picks the default and the order.** `web/src/assets/datasets/manifest.json` =
   `{ "default": "<slug>", "order": ["<slug>", ...] }`. Slug = filename without `.json`. Files
   not in `order` are appended alphabetically, so dropping a file in works without touching the
   manifest.
4. **Switching datasets is an undoable replace**, same pattern as import
   (`App.svelte:120-123`): snapshot, replace, clear highlight and selection, note in chat. Reset
   (`App.svelte:78-83`) resets to the *current* dataset, not the default.
5. **`tree.js` is deleted**, not kept as a re-export. The schema test that imports it is
   repointed at the default dataset file.

## Phase 1 — Dataset loader

1. Add `web/src/lib/datasets.js`:
   - `const files = import.meta.glob('../assets/datasets/*.json', { eager: true, import: 'default' })`
     and `import manifest from '../assets/datasets/manifest.json'`.
   - Export `DATASETS: { id, title, document }[]` ordered per Decision 3; `title` from
     `document.meta.title`, falling back to the slug.
   - Export `DEFAULT_DATASET_ID = manifest.default` and `getDataset(id)`.
   - In `import.meta.env.DEV`, run `parseDocument(document)` on each and `console.error` any
     failure prefixed `[datasets] <file>:`; this replaces `App.svelte:11-17`. Throw at import
     time if `manifest.default` names no file, so a broken manifest is a blank page with a stack
     trace, not a silent fallback.
2. Move the data: `web/src/lib/tree.js:9-292` →
   `web/src/assets/datasets/workflow-platform-fy26.json` as
   `{ "schemaVersion": 1, "meta": { "title": "Workflow platform, FY26", "period": "FY26", "exportedAt": "2026-09-11T00:00:00Z", "generator": "hand-authored" }, "tree": { "nodes": [...] } }`.
   Keep node ids unchanged so the README demo script still works. Delete `tree.js`.
3. Add `manifest.json` with `"default": "workflow-platform-fy26"` and `order` listing it first.

## Phase 2 — Two more datasets

Hand-author (README: "a hand-tuned tree demos better than a realistic one"). Each must have at
least three nodes with `contributes < 0.4` and at least two KRs with empty `metric`, so the demo
questions still find something.

1. `starter.json`: one company objective, two team objectives, six KRs. The "explain the
   product in ten seconds" tree.
2. `regional-clinic-network.json`: ~30 nodes in a different industry (healthcare operations:
   patient access, clinical quality, revenue cycle, staffing). Different vocabulary proves the
   coach prompt is not tuned to SaaS.

Ids in every file follow `co-*`, `obj-*`, `kr-*` so the prompt's id guidance
(`service/prompt.js:45`) holds across datasets.

## Phase 3 — App wiring

1. `App.svelte:5`: replace the `initialTree` import with
   `import { DATASETS, DEFAULT_DATASET_ID, getDataset } from './lib/datasets.js'`. Remove
   `:11-17`.
2. `App.svelte:21`: `let datasetId = $state(DEFAULT_DATASET_ID);` then
   `let tree = $state.raw(structuredClone(getDataset(datasetId).document.tree));`
3. `reset()` at `App.svelte:78-83`: reset to `getDataset(datasetId).document.tree`.
4. Add `switchDataset(id)`: no-op if same id; push a snapshot onto `undoStack`; set
   `datasetId` and `tree`; `highlight = []`, `selectedId = null`; push a note message
   `Loaded "<title>" (<n> nodes). Undo to go back.`
5. Topbar (`App.svelte:158-165`): a `<select>` before Undo listing `DATASETS` by title, with
   `value={datasetId}` and `onchange={(e) => switchDataset(e.target.value)}`. Use `onchange`
   rather than `bind:value` so the snapshot happens before the state changes. Undo of a dataset
   switch restores the tree but not the picker value; after undo, set `datasetId` from the
   snapshot too (store `datasetId` alongside `tree` in the snapshot).
6. `exportTree()` at `App.svelte:95`: `meta.title` becomes the current dataset title so an
   exported file names its origin.
7. `web/src/app.css` near `:50-60`: style `.topbar select` to match `button.ghost`.

## Phase 4 — Tests and docs

1. `schema/test/document.test.js:7`: replace the `tree.js` import with
   `JSON.parse(readFileSync(new URL('../../web/src/assets/datasets/workflow-platform-fy26.json', import.meta.url)))`
   and use `.tree`. Add `schema/test/datasets.test.js`: every `*.json` in the datasets folder
   except `manifest.json` passes `parseDocument` with zero warnings; `manifest.default` and
   every `order` entry name an existing file.
2. README `Layout` block (`README.md:181`) and build-order row 1 (`README.md:201`):
   `lib/tree.js` → `assets/datasets/*.json` + `lib/datasets.js`.

## Verification

- `docker exec -w /src dev npm run test:schema` passes, including the new datasets test.
- Boot: the default dataset renders; the node count in the topbar matches the file. Dev console
  shows no `[datasets]` errors.
- Pick each dataset in the select: the graph re-lays out, chat shows the note, Undo returns to
  the previous tree and picker value, Reset returns to the current dataset's pristine tree.
- Export while on `starter`, switch to the clinic dataset, Import the file: the starter tree is
  back. The picker still shows the clinic dataset (built-ins only; see Out of scope).
- Corrupt a node in one dataset (empty label): dev boot logs a `[datasets]` error naming the
  file and the path.

## Out of scope

- Loading datasets from a URL or the service. The service stays stateless and data-free.
- Remembering the chosen dataset across reloads (nothing persists yet).
- A "custom" entry in the picker for imported files.
- `company` and `history` sections in the datasets: `TEAM_MODEL_AND_EDITOR` adds `company` to
  these files; the format already allows it.

## Risks / rollback

- `import.meta.glob` with `eager: true` bundles every dataset into the main chunk. Three files
  of ~30 nodes is a few KB. If datasets grow past a few hundred KB, switch to a lazy glob and a
  loading state.
- Rollback: restore `tree.js` from git, revert `App.svelte` and the test. Datasets are additive
  files.

## Completion notes

- **Planned vs. actual.** The phases landed as written. `datasets.js` is the only new module;
  `import.meta.glob('../assets/datasets/*.json', { eager: true, import: 'default' })` plus the
  manifest gives the picker its order, and the three datasets
  (`workflow-platform-fy26` 27 nodes, `starter` 9, `regional-clinic-network` 30) all pass
  `parseDocument` with zero warnings. `tree.js` is gone; `schema/test/document.test.js` now reads
  the default dataset off disk, and `schema/test/datasets.test.js` holds every file to the
  document bar plus the demo's own bar (≥3 weak links, ≥2 unmeasurable KRs per dataset).
- **Mid-flight adjustments.** Two small deviations from the phase text. (a) Undo snapshots are now
  `{ tree, datasetId }` rather than a bare tree — Phase 3.5 asked for the picker to follow undo,
  and a helper `snapshot()` keeps the four push sites honest. (b) The initial tree reads
  `getDataset(DEFAULT_DATASET_ID)` rather than `getDataset(datasetId)`; Svelte 5 warns
  `state_referenced_locally` on the latter, and the two are the same value at init.
- **Surprises / residual risks.** `import.meta.glob` matches `manifest.json` too, so the loader
  skips that slug explicitly — a dataset may never be named `manifest`. The `[datasets]` boot
  validation is `import.meta.env.DEV`-only and is tree-shaken out of `vite build`, so it was
  verified by a one-off build with `define: { 'import.meta.env.DEV': true }`; a corrupted label
  logs `[datasets] starter.json: invalid document: /tree/nodes/7/label: must NOT have fewer than
  1 characters`, and a bogus `manifest.default` throws at import time as intended. Datasets are
  inlined in the main chunk (~20 KB of JSON today); the lazy-glob escape hatch in Risks still
  applies if they grow.
