---
tags:
  - plan
  - schema
  - web
  - service
  - teams
status: completed
created: 2026-09-11
completed_on: 2026-09-11
predecessors:
  - completed/OKR_SCHEMA_PACKAGE.md
  - completed/BUNDLED_DATASETS.md
  - completed/OKR_NODE_EDITOR.md
successors:
  - development/CHAT_CONTEXT.md
  - development/CHAT_TABS_AND_INTERVIEWS.md
---
# Plan: Model teams with a charter, reference them from nodes, and edit them in a panel

Concept: [Teams as Agents - Design](../../Concepts/Teams%20as%20Agents%20-%20Design.md) (why the
charter looks the way it does) and
[OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md).

## TL;DR

Extend the existing `CompanyUnit` with an optional `charter` (mission, process, owns[],
dependsOn[]), add an optional `unitId` to nodes, and add three team Actions
(`editUnit`, `addUnit`, `deleteUnit`) so team edits flow through the same commit/undo/history
path as node edits. The web app holds `company` in state, ships it in the datasets, gains a
Teams list and a TeamEditor panel, swaps the node editor's owner field for a team picker, and
can show team names as labels in the 3D view. The service receives `company` with every chat
request, describes teams to the model, and validates team references. Schema changes are
additive (no `schemaVersion` bump). Multi-agent features are designed in the concept doc and
not built here.

## Context

`schema/src/company.schema.json` already defines `Company { name, units[], people[] }` with
`CompanyUnit { id, name, parent, lead? }` (`:36-65`), but nothing in `web/` or `service/` uses
it, and `createDocument` only carries it if passed (`schema/index.js:247`). Node `owner` is free
text (`schema/src/okr-node.schema.json:38-42`), so "Marketing" on `obj-2` and "Field Marketing"
on `kr-9` are strings with no relationship. The product wants a team to be a thing the user can
describe (business process, ownership domain) and that the model can be handed as context, now
for answering "what does this team own?" and later as an agent persona.

`OKR_NODE_EDITOR` establishes `commit()` and history in `App.svelte`; this plan assumes it has
landed (or lands first) so team edits reuse it.

## Goal

Teams are first-class, chartered data in the document; nodes reference them; the user edits
them in a panel; team edits are undoable Actions; the assistant sees them on every request.

## Decisions (locked in)

1. **Extend `CompanyUnit`, don't add a `teams` entity.** (Interview, 2026-09-11.) A unit gains
   an optional `charter`. Nodes gain optional `unitId`. `owner` stays and becomes derived
   display text: the apply layer sets `owner = unit.name` whenever `unitId` changes and `owner`
   is not explicitly given. Additive; `SCHEMA_VERSION` stays 1.
2. **Charter shape** (from the concept doc): `mission` (≤ 1000 chars), `process` (≤ 4000),
   `owns` (≤ 50 strings of ≤ 200), `dependsOn` (≤ 50 unit ids). All optional.
3. **Team edits are Actions**: `editUnit { id, fields: { name?, parent?, lead?, charter? } }`
   with `charter` merged shallowly into the existing one; `addUnit { id, fields: { name, parent?, charter? } }`;
   `deleteUnit { id }`, which reparents child units to the deleted unit's parent and clears
   `unitId` on the nodes it owned (their `owner` text is kept). One vocabulary for the model and
   the UI; one undo stack; one history.
4. **State is document-shaped.** `App.svelte` holds `company`; undo snapshots become
   `{ tree, company, history }`; `applyDocumentActions({ tree, company }, actions)` dispatches
   node ops to `applyAction` and unit ops to a new `applyUnitAction`.
5. **One panel slot.** `panel = $state(null | { kind: 'node' | 'team' | 'teams', id? })` in
   App replaces the implicit "Detail is open iff a node is selected". Selecting a node sets
   `{ kind: 'node' }`; the Teams button sets `{ kind: 'teams' }`; picking a team sets
   `{ kind: 'team', id }`. `CHAT_CONTEXT` reads this directly.
6. **`company` rides in the chat request** (optional). The service validates it, describes
   teams to the model, and checks `unitId` / unit ids in actions against it. No new endpoint.
7. **Team labels in 3D are a toggle, off by default**, rendered with `three-spritetext` as a
   child of each node mesh. Teams are not nodes or colours in this round.
8. **People stay out of the editor.** `people` remains in the schema, untouched.

## Phase 1 — Schema (additive)

1. `schema/src/company.schema.json:36-65` (`unit`): add
   `"charter": { "$ref": "#/definitions/charter", "description": "How this team works and what it owns, written so it can be handed to a model as the team's own voice." }`.
   Add `definitions.charter` (title `TeamCharter`) with `mission`, `process`, `owns`,
   `dependsOn` per Decision 2, every property with a prompt-quality description
   ("in the team's own words", "systems, metrics or decisions this team is the accountable owner
   of"). `additionalProperties: false`.
2. `schema/src/okr-node.schema.json:38-42`: after `owner`, add `unitId`
   (`type: ["string", "null"]`, id pattern, description "Id of the owning team in
   company.units. owner is the display name derived from it."). Keep `required` (`:52`).
3. `schema/src/action.schema.json`:
   - `editableFields` (`:30-70`) and `addFields` (`:71-116`): add `unitId` (string or null).
   - New definitions `unitFields` (`name?`, `parent?`, `lead?`, `charter?` as a partial
     `TeamCharter`, `minProperties: 1`), `addUnitFields` (`name` required, `parent?`,
     `charter?`), and branches `editUnitAction`, `addUnitAction`, `deleteUnitAction` mirroring
     `:117-210`; add them to the root `oneOf` (`:6-23`). Descriptions say when to use each and
     that `deleteUnit` un-owns nodes rather than deleting them.
4. `schema/src/chat-request.schema.json:7-32`: add optional
   `"company": { "$ref": "company.schema.json" }`.
5. `schema/scripts/build.mjs:43-56` `VALIDATORS`: add `validateEditUnitAction`,
   `validateAddUnitAction`, `validateDeleteUnitAction`. `schema/index.js:103-108`
   `ACTION_BRANCHES`: add the three ops. `schema/index.d.ts:9-55`: export the new types
   (`TeamCharter`, `UnitFields`, `AddUnitFields`, `EditUnitAction`, `AddUnitAction`,
   `DeleteUnitAction`).
6. `schema/index.js`: add `checkCompanySemantics(company)` (unique unit ids, parent exists, no
   parent cycles, `lead` names a person, `person.unitId` exists, `dependsOn` ids exist as a
   warning) and `checkOwnership(tree, company)` (node `unitId` not in units → warning, never an
   error, since a tree mid-edit may dangle). Call both from `parseDocument` after `:298`; errors
   block, warnings pass through. Export both and declare them in `index.d.ts`.
7. Fixtures: `valid/company.chartered.json`, `valid/action.edit-unit.json`,
   `valid/action.add-unit.json`, `valid/action.delete-unit.json`, `valid/okr-node.with-unit.json`,
   `invalid/action.edit-unit-empty-fields.json`, `invalid/action.add-unit-without-name.json`,
   `invalid/company.charter-unknown-field.json`. Semantics tests for the two new checks in
   `schema/test/semantics.test.js`.
8. `docker exec -w /src dev npm run build:schema && npm run test:schema`.

## Phase 2 — Web state and apply layer

1. `web/src/lib/company.js` (new, pure like `apply.js`): `unitDescendants(company, id)`,
   `applyUnitAction(company, action)` for the three ops per Decision 3 (a parent that would
   cycle is ignored, as in `apply.js:68`), `unitName(company, id)`.
2. `web/src/lib/apply.js:16` `EDITABLE`: add `unitId`. Add
   `applyDocumentActions({ tree, company }, actions)` per Decision 4: for node ops whose
   `fields.unitId` changes and `fields.owner` is absent, fill `owner` from `unitName`; for
   `deleteUnit`, also map `tree.nodes` clearing that `unitId`. Keep `applyActions(tree, actions)`
   exported for the tests, delegating to the new function with `company: null`.
3. `App.svelte`: add `let company = $state.raw(...)` seeded from the dataset's `company`, or
   `{ name: dataset.title, units: [] }` when absent. Snapshots and `undo()`/`reset()`/
   `importTree()`/`switchDataset()` carry `company`. `commit()` calls `applyDocumentActions`.
   `exportTree()` passes `company` to `createDocument`.
4. `App.svelte:23`: replace the implicit Detail-open rule with `panel` (Decision 5).
   `select(id)` sets `panel = id ? { kind: 'node' } : null`. Any selection change, including a
   background click, closes a team panel: one thing at a time.
5. Datasets: add `company` to `web/src/assets/datasets/workflow-platform-fy26.json` with units
   for every distinct `owner` in the tree, parented sensibly (Growth, Design under Product;
   Content, Field Marketing under Marketing; Customer Success, Sales Ops under Sales; Platform,
   SRE, Dev Infra, Security under Engineering; Talent under People; Exec at the top), charters
   for at least the six top-level units (2–3 sentences of mission and process, 3–5 `owns`
   entries, `dependsOn` where obvious, e.g. Marketing → Product), and `unitId` on every node.
   `starter.json` gets three units with charters. The datasets test (from `BUNDLED_DATASETS`)
   now also asserts zero ownership warnings.

## Phase 3 — Teams list and TeamEditor panel

1. Topbar (`App.svelte:158-165`): a `Teams` button → `panel = { kind: 'teams' }`,
   `selectedId = null`.
2. `web/src/TeamList.svelte` (new): units as an indented tree by `parent`, each row shows the
   name and the count of owned nodes; click → `panel = { kind: 'team', id }`; `+ Add team` →
   `onEdit({ op: 'addUnit', id: newUnitId(), fields: { name: 'New team', parent: null } })`
   then open it. Reuses the `.detail` panel styling.
3. `web/src/TeamEditor.svelte` (new). Props: `unit`, `company`, `tree`, `onEdit`, `onSelect`,
   `onBack`, `onClose`, `onFocusField` (for `CHAT_CONTEXT`). Always editable (a team panel is an
   editor; no read mode). Fields, each committing on blur/Enter if changed via
   `onEdit({ op: 'editUnit', id, fields })`:
   - `name` (input; empty rejected inline).
   - `parent` (select of units excluding self and `unitDescendants`).
   - `charter.mission` (textarea, placeholder "Why this team exists, in its own words").
   - `charter.process` (textarea, placeholder "The process it runs: inputs, steps, outputs, cadence").
   - `charter.owns` (textarea, one item per line → array on commit).
   - `charter.dependsOn` (checkbox list of other units).
   - Owned nodes: `tree.nodes.filter(n => n.unitId === unit.id)` as link buttons → `onSelect`.
   - `Delete team` with `confirm()` naming the owned-node count → `onEdit({ op: 'deleteUnit', id })`
     then `onBack()`.
   Header has a `← Teams` back button and (from `CHAT_TABS_AND_INTERVIEWS`) an
   "Interview me about this team" button.
4. `App.svelte:170-181`: render `TeamList` or `TeamEditor` in the panel slot when `panel.kind`
   is `teams` / `team`, `Detail` when `node`. `onEdit` for both →
   `commit([a], { actor: 'user', reason })`.
5. `web/src/app.css`: `.detail textarea`, checkbox list, indented list rows.

## Phase 4 — Node editor integration

1. `Detail.svelte` (edit mode from `OKR_NODE_EDITOR`): the owner `<input>` becomes a
   `<select>` of `company.units` plus "— none —" when `company.units.length`; on change →
   `onEdit({ op: 'edit', id, fields: { unitId } })` (the apply layer fills `owner`). Falls back to
   the text input when there are no units.
2. Read mode: owner renders as a link button that opens `panel = { kind: 'team', id: unitId }`
   when `unitId` resolves.
3. `Graph.svelte:108` tooltip: prefer `unitName(company, n.unitId)` over `n.owner`; pass
   `company` as a prop (`:6`).

## Phase 5 — Service

1. `service/index.js:24`: destructure `company = null`; if present run `checkCompanySemantics`
   (errors → 400 like the tree at `:28-31`) and `checkOwnership` (warnings → log).
2. `service/prompt.js:21` `systemPrompt(tree, company, selectedNodeId)`: after the `<tree>`
   block (`:27-29`) add a `<teams>` block with `units` (id, name, parent, charter) when present,
   plus prose: "Nodes reference teams by `unitId`; `owner` is display text and is filled in
   automatically when you set `unitId`." Extend `## Actions` (`:42-48`) with the three unit ops
   and when to use them ("only change a charter when the user tells you something about how the
   team works"). Add a `<teams>` example line so ids are quoted correctly.
3. `service/validate.js:36` `validateResponse(tree, company, input)`: build `knownUnits`;
   node `edit`/`add` with `fields.unitId` not in `knownUnits` (and not null) → drop that field
   (reject with reason, keep the rest, as done for `parent` at `:69-72`); `editUnit`/`deleteUnit`
   need a known id; `addUnit` needs a unique id and a known-or-null parent; `dependsOn` entries
   must be known. Node-op handling at `:53-98` is unchanged.
4. `service/index.js:56`: pass `company`; `:42`: pass `company` to `systemPrompt`.
5. `App.svelte:42` request body: add `company`.

## Phase 6 — Team labels in the 3D view (independently shippable)

1. `web/package.json`: add `three-spritetext@^1.9`.
2. `Graph.svelte:6` props: `showTeamLabels = false`, `company`. In `makeNodeObject`
   (`:32-41`): create `new SpriteText('', 3, '#8b96ad')` with `material.depthWrite = false`,
   position `y = -(cfg.size + 4)`, `visible = false`, add as a child of the mesh, keep a
   reference in `mesh.userData.label`.
3. A `$effect` over `tree`, `company`, `showTeamLabels`: for each mesh set
   `label.text = unitName(company, node.unitId) ?? node.owner ?? ''` and
   `label.visible = showTeamLabels && !!label.text`. Node objects are reused across data
   updates (`:45-50`), so the effect must update text in place rather than rely on
   `makeNodeObject` re-running.
4. Legend (`App.svelte:175-180`): a `<label><input type="checkbox" bind:checked={showTeamLabels}> Team labels</label>`
   with `pointer-events: auto` on that element (the legend is `pointer-events: none`,
   `app.css:71`).

## Verification

- Schema: `npm run test:schema` passes with the new fixtures; `dist/types.d.ts` declares
  `TeamCharter` once; `respond-input.json` contains the unit ops.
- Datasets: zero warnings from `parseDocument` on every dataset, including ownership.
- Teams panel: add a team, rename it, set a mission, assign it as parent of another: each is
  one undo step; `⌘Z` walks back through them; Export shows `actor: "user"` entries with
  `editUnit` actions.
- Delete "Field Marketing": `kr-9` keeps `owner: "Field Marketing"` text but `unitId` is null;
  Detail shows the owner as plain text, not a link; undo restores the link.
- Node editor: change `kr-9`'s team to Marketing: `owner` reads "Marketing", tooltip agrees.
- Service: `curl` a request with `company` whose unit parent is missing → 400 naming the path.
  Ask "what does Marketing own?" → reply lists its nodes, highlight equals them. Ask "move the
  case studies KR to Content" → an `edit` with `unitId: "content"` (or whatever the id is) and
  `owner` filled client-side. Ask "make Sales depend on Engineering" → `editUnit` with
  `charter.dependsOn`.
- Labels: toggle on → every node with a team shows its name under the sphere, readable at the
  default zoom; toggle off → gone; switching datasets updates the text.

## Out of scope

- Personas, debates, reviews (concept doc; future `TEAM_AGENT_DISCUSSIONS.md`).
- Managing `people` or `lead` in the editor (schema only).
- Colouring or grouping nodes by team; teams as graph nodes.
- A migration that turns `owner` strings into units for imported files without `company`. The
  app tolerates missing `company` (empty units, text owners).
- Recording team edits in `history` differently from node edits; they are the same `change`
  entries.

## Risks / rollback

- The `oneOf` on `Action` grows from four to seven branches; Ajv error refinement in
  `schema/index.js:116-133` reads `op` first, so messages stay one-line. The flattened tool
  schema grows accordingly; check the `[chat]` token log for the input-token delta (expect
  +1–2k with charters).
- Charter prose in every request raises input tokens linearly with team count. Cap by sending
  only units referenced by the tree plus their ancestors if it becomes a problem.
- Rollback: schema changes are additive and gated by optional fields; reverting the web and
  service changes leaves documents with `unitId`/`charter` still valid.

## Completion notes

- **Planned vs. actual.** All six phases landed as written. The schema half went in unchanged:
  `charter` on `CompanyUnit`, `unitId` on the node, the three unit ops, `company` on the chat
  request, `checkCompanySemantics` / `checkOwnership`, and the eight fixtures. Phases 2–6 landed
  as designed too — `web/src/lib/company.js`, `applyDocumentActions`, the `panel` slot,
  `TeamList` / `TeamEditor`, the Detail team picker, and `three-spritetext` labels. What moved
  was every `file:line` citation: all three predecessors shipped after this plan was written, so
  the App.svelte line numbers in Phases 2–6 were stale by 100+ lines and `tree.js` no longer
  exists. The citations were re-verified against the tree before each edit; the schema ones
  (Phase 1) were still accurate apart from `okr-node.schema.json:38-42`, which names `target`,
  not `owner`.
- **Mid-flight adjustments.** (1) `company` went into all three datasets, not just the two the
  plan names — `regional-clinic-network` shipped with `BUNDLED_DATASETS` after this plan was
  written, and leaving it team-less would have made the Teams panel empty for a third of the
  picker. (2) The charter textareas commit on blur and revert on Escape, but Enter inserts a
  newline rather than committing: `process` is multi-paragraph prose, and Detail's
  Enter-commits rule does not survive contact with it. The `name` input keeps Enter-commits.
  (3) `deleteUnit` also prunes the deleted id out of every other team's `charter.dependsOn`, so
  a delete cannot leave the org pointing at a ghost — the plan only specified reparenting
  children and un-owning nodes. (4) `describe()` for `editUnit` names the charter field that
  changed ("Edited mission of the Marketing team"), not the word "charter". (5) A stale team
  panel (undo, dataset switch, delete) falls back to the Teams list via an `$effect`, which the
  plan did not call for but the one-panel-slot decision needs. (6) `onFocusField` is wired as an
  optional no-op prop so `CHAT_CONTEXT` is a one-line change; the "Interview me about this team"
  button is left to `CHAT_TABS_AND_INTERVIEWS`, as its own plan owns it.
- **Surprises / residual risks.** Adding `unitId` to the datasets broke two existing tests in a
  way worth keeping: `document.test.js` built a document from the default *tree* with no
  `company`, which is now 27 ownership warnings — the fix was to carry the org with the tree,
  which is exactly the invariant the check exists to enforce. The measured input-token cost of
  the `<teams>` block on the default dataset is **+1,470 tokens** (8,751 → 10,221), inside the
  plan's +1–2k estimate, and it grows linearly with team count and charter length; the cap
  suggested in Risks (send only referenced units plus ancestors) is still unbuilt. Team labels
  are legible once the camera is near a subtree but are small at the default zoomed-out view —
  a fixed sprite height in world units, which is the tradeoff the plan chose. Finally,
  `applyActions` in `apply.js` is now dead code in the app (only `applyDocumentActions` is
  called); the plan asked for it to stay exported for tests, and there are no web tests yet.
