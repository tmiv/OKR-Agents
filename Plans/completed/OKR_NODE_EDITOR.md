---
tags:
  - plan
  - web
  - schema
  - editing
status: completed
created: 2026-09-11
completed_on: 2026-09-11
predecessors:
  - completed/OKR_SCHEMA_PACKAGE.md
successors:
  - completed/TEAM_MODEL_AND_EDITOR.md
  - development/CHAT_CONTEXT.md
---
# Plan: Edit OKR node details in the Detail panel through one commit path that records history

Concept: [OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md)
(invariant 3: "every mutation is an Action through one commit path").

## Context

`web/src/Detail.svelte` is read-only: label (`:17`), owner/metric/target (`:18-24`), fit bar
(`:28-32`), children (`:35-45`). The only way to change a node is to ask the assistant. The one
writer today is `send()` in `web/src/App.svelte:57-60`: snapshot, `applyActions`, done. The
`History` schema (`schema/src/history.schema.json`) with
`changes: [{ at, actor: user|assistant|import, reason, actions }]` exists and nothing writes it.

## Goal

A user can edit label, owner, metric, target, contributes and parent of the selected node in
place; each edit is an Action applied through a shared `commit()` that snapshots for undo and
appends to `history.changes`; history rides along in Export/Import.

## Decisions (locked in)

1. **Edit mode inside Detail, per-field commit.** (Interview, 2026-09-11.) An Edit toggle swaps
   text for inputs; each field commits on blur or Enter if its value changed. No Save/Cancel.
   Undo (`⌘Z`) is the cancel.
2. **User edits are Actions.** The editor emits `{ op: 'edit' | 'relink', id, fields }` exactly
   as the model would, so `apply.js`, `validateAction`, the undo stack and history treat both
   authors identically. No second mutation path.
3. **One `commit(actions, { actor, reason })` in App.svelte** replaces the inline
   snapshot/apply at `:57-60`. It validates each action with `validateAction`, pushes
   `{ tree, history }` onto `undoStack`, applies, and appends `{ at, actor, reason, actions }` to
   `history.changes`. Undo restores both tree and history, so undo is a true revert; history is
   state, not an audit log of undos.
4. **Level is not editable.** Matches the prompt rule "Never change a node's level"
   (`service/prompt.js:47`). Parent choices are restricted to the on-ladder level (objectives for
   a KR, the company root for an objective; none for the root).
5. **Contributes commits on `change`, not `input`.** One undo step per slider release.
6. **Owner is a text input in this plan.** `TEAM_MODEL_AND_EDITOR` swaps it for a team picker;
   the field name and the commit shape do not change.
7. **`editing` state lives in App**, passed down as a prop, so `CHAT_CONTEXT` can report it.

## Phase 1 — `commit()` and history state

1. `App.svelte:22`: add `let history = $state.raw({ metricSamples: [], changes: [] });`.
   Undo snapshots become `{ tree, history }`: update `undo()` (`:70-76`) to restore both,
   `reset()` (`:78-83`) and `importTree()` (`:119-121`) to snapshot the pair. Import loads
   `out.document.history ?? { metricSamples: [], changes: [] }`; reset restores the dataset's
   own history (empty until datasets carry one).
2. Add `commit(actions, { actor, reason })` per Decision 3. Drop any action that fails
   `validateAction` with a dev `console.warn`; return early if nothing survives.
3. `send()` at `:57-60` → `commit(actions, { actor: 'assistant', reason: reply })`.
4. `importTree()` → after replacing state, `commit([], { actor: 'import', reason: 'Imported <file.name>' })`
   so the log shows the boundary (the schema allows an empty `actions` array).
5. `exportTree()` at `:95`: `createDocument({ tree, history, meta })`.
6. Dev-only assertion after each commit: `validateHistory(history).ok`, else `console.error`.

## Phase 2 — Editable Detail

1. `Detail.svelte:2` props: add `editing`, `onToggleEdit`, and `onEdit` (receives one Action).
2. Header (`:13-16`): an `Edit` / `Done` toggle before the close button.
3. When `editing`:
   - `h2` (`:17`) → `<textarea rows="2">` bound to `draft.label`; commit on blur or Enter
     (without Shift) when `draft.label.trim() !== node.label` →
     `onEdit({ op: 'edit', id: node.id, fields: { label } })`. An empty label is rejected inline
     (`.invalid` outline; schema `minLength: 1`) and the old value restored.
   - Owner, metric, target (`:19-24`) → `<input>` with the same commit rule; empty is allowed
     (schema permits `""`).
   - Fit (`:28-32`) → `<input type="range" min="0" max="1" step="0.05">` bound to
     `draft.contributes`, live preview through the existing `.bar`, commit on `change`.
   - Supports (`:26-27`) → `<select>` of allowed parents (Decision 4) plus the current one; on
     change → `onEdit({ op: 'relink', id: node.id, fields: { parent } })`.
4. Re-seed `draft` in a `$effect` keyed on `node` so an undo while editing shows the reverted
   values and a commit that replaces the node object does not leave a stale draft.
5. Keyboard: `Escape` in a field restores that field from `node` and blurs without committing.
   `App.svelte:140-142` already ignores `⌘Z` while an input or textarea has focus; add `SELECT`
   to that list.
6. `web/src/app.css` `.detail` block (`:85-115`): inputs styled like `.chat textarea`
   (`:145-149`), an `.edit-toggle`, and an `.invalid` outline in `var(--bad)`.
7. `App.svelte:172-173`: pass `editing`, `onToggleEdit`, and `onEdit={(a) => commit([a], { actor: 'user', reason: describe(a) })}`
   where `describe` renders a short reason like `Edited label of "<old label>"`. Closing the
   panel or selecting another node sets `editing = false`.

## Phase 3 — Add child and delete (independently shippable)

1. In edit mode, `+ Add key result` (or `+ Add objective` on the root) under the children list
   (`Detail.svelte:35-45`):
   `onEdit({ op: 'add', id, fields: { level, parent: node.id, label: 'New key result', owner: node.owner, contributes: 0.5 } })`
   then `onSelect(id)` with `editing` kept on and the label focused. `id` = `kr-` / `obj-` plus
   a 4-char base36 suffix, retried until unique (`apply.js:74` turns an add with an existing id
   into an edit, so uniqueness matters).
2. `Delete` with a `confirm()` naming the subtree size (`descendants()` from
   `web/src/lib/apply.js:33`). Hidden on the root. On confirm → `onEdit({ op: 'delete', id })`
   then `onSelect(parentId)`.

## Verification

- Edit a label, press Enter: Detail and the 3D tooltip (`Graph.svelte:108`) show the new text,
  the topbar Undo count increments, `⌘Z` restores.
- Drag the slider on `kr-4` from 0.25 to 0.9: the edge turns green (`Graph.svelte:110-111`),
  the "weak links" count drops by one, exactly one undo step.
- Relink `kr-9` from Marketing to Sales: the edge moves, the DAG re-lays out without a full
  reheat, undo puts it back.
- Export: the file has one `history.changes` entry per edit with `actor: "user"`, and the
  assistant's entries carry `reason` equal to its reply. Import that file: history is present,
  Undo count is 0 (the undo stack does not travel).
- `docker exec -w /src dev npm run test:schema` passes; add
  `schema/test/fixtures/valid/history.user-change.json`.
- Ask the assistant to rewrite a KR after a manual edit: its reply reflects the edited text.

## Out of scope

- Editing `level` or `id`. Redo.
- `history.metricSamples` (nothing produces readings yet).
- Bulk or multi-node editing.
- The team picker for `owner` (`TEAM_MODEL_AND_EDITOR`).

## Risks / rollback

- Undo snapshots now clone `history` on every commit, O(changes). At demo scale (hundreds of
  changes) that is microseconds. If it ever matters, snapshot `changes.length` and truncate on
  undo instead.
- Rollback: the Detail changes are additive; `commit()` is a refactor of existing behaviour.
  Revert the two files.

## Completion notes

- **Planned vs. actual.** All three phases landed as written, in one pass on `okr-node-editor`:
  `commit()` + `history` in `web/src/App.svelte`, edit mode in `web/src/Detail.svelte`, the
  `.detail` edit styles in `web/src/app.css`, and
  `schema/test/fixtures/valid/history.user-change.json`. The per-field commit-on-blur-or-Enter
  shape, Actions-as-the-only-mutation-path, and "level is not editable" all held up unchanged.
  Line citations had drifted: `tree.js` is gone (datasets now), `App.svelte`'s undo entries are
  `{ tree, datasetId }` built by `snapshot()`, and `select(id)` clears `highlight` — the new
  history field slots into `snapshot()` rather than replacing it, so the stack entry is
  `{ tree, datasetId, history }`.
- **Mid-flight adjustments.** (1) `commit()` grew an `undoable` option: `importTree()` already
  snapshots before replacing the tree, so the import marker commits with `undoable: false` and
  one import stays one undo step. The plan's Verification line "Undo count is 0" after import
  does not match the app — import has been snapshot-then-replace since BUNDLED_DATASETS; the
  count goes up by exactly one. (2) `switchDataset()`, which post-dates the plan, resets history
  the same way `reset()` does. (3) Detail keeps a small `sent` map per node, because the blur
  that follows an Enter commit fires before the new `node` prop arrives and would otherwise
  re-send the same edit. (4) The `.invalid` mark on an empty label clears on the next keystroke,
  not on that follow-up blur, or it would flash and vanish. (5) `select(id, keepEditing)` — the
  "add a child" path is the only caller that keeps edit mode on.
- **Surprises / residual risks.** `send()` had a local `const history` for the chat transcript
  that now shadows the state; renamed to `chatHistory` — worth remembering when CHAT_CONTEXT
  extends that request body. The assistant half of the Verification ("its reply reflects the
  edited text") could not be run for real: no API key for `/api/chat`. It was exercised with a
  stubbed `fetch` response instead, which confirmed the request body carries the hand-edited
  tree and that an assistant batch commits with `reason` equal to its reply — but no model was
  involved. `history` is cloned on every commit (Risks above); still microseconds at demo scale.
