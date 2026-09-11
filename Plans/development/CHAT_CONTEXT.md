---
tags:
  - plan
  - web
  - service
  - schema
  - chat
status: development
created: 2026-09-11
predecessors:
  - development/OKR_NODE_EDITOR.md
  - completed/TEAM_MODEL_AND_EDITOR.md
successors:
  - development/CHAT_TABS_AND_INTERVIEWS.md
---
# Plan: Send the user's view context with every message so the assistant resolves references

Concept: [OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md)
("pointing plus seeing").

## Context

The request carries `selectedNodeId` (`schema/src/chat-request.schema.json:18-22`) and the
prompt turns it into one sentence (`service/prompt.js:31-35`). After `OKR_NODE_EDITOR` and
`TEAM_MODEL_AND_EDITOR`, the user may have a node in edit mode with a field focused, a team
editor open, or a set of highlighted nodes from the last reply. "Make this measurable", "what
does this team own", "move those under Sales" should resolve without the user naming anything.

## Goal

`/api/chat` receives a `context` object describing what is on screen, and the system prompt
states it so "this", "it", "those" and "the team" resolve to the right node, team or highlight
set.

## Decisions (locked in)

1. **Additive.** `selectedNodeId` stays top-level; a new optional `context` holds the rest. No
   fixture or existing client breaks.
2. **Shape:**
   ```
   context: {
     panel:       { kind: 'node' | 'team' | 'teams', id?: string, editing?: boolean,
                    field?: string } | null,
     highlighted: string[],      // node ids currently pulsing
     dataset:     string         // meta.title, so the model can name it
   }
   ```
   `field` is one of the editor field names (`label`, `owner`, `metric`, `target`,
   `contributes`, `parent`, `name`, `mission`, `process`, `owns`, `dependsOn`). All properties
   optional; `additionalProperties: false`.
3. **The service sanitises, never rejects.** Unknown node or unit ids in `context` are dropped
   with a `[chat] context:` log line, mirroring how `selectedNodeId` is checked at
   `service/index.js:34`. Context is advisory.
4. **Resolution rules live in the prompt, in labels not ids:** "this / it / here" → the focused
   field's node or team, else the open panel, else the selected node; "those / them / these" →
   the highlighted set; "the team / my team" → the open team, else the selected node's team.
5. **One builder.** `viewContext()` is a `$derived` in `App.svelte`, reused by
   `CHAT_TABS_AND_INTERVIEWS`.

## Phase 1 — Schema

1. `schema/src/chat-request.schema.json:7-32`: add `context` as `$ref: "#/definitions/viewContext"`;
   add `definitions.viewContext` (title `ViewContext`) and `definitions.openPanel` (title
   `OpenPanel`) per Decision 2, with descriptions that tell the model what each means ("the
   field the user's cursor is in right now").
2. Fixtures: `valid/chat-request.with-context.json`, `invalid/chat-request.context-bad-panel-kind.json`.
3. `schema/index.d.ts`: export `ViewContext`, `OpenPanel`. Rebuild.

## Phase 2 — Web

1. `App.svelte`: add `let focusedField = $state(null)`. `Detail.svelte` and `TeamEditor.svelte`
   receive `onFocusField(name | null)` and call it from each input's `onfocus` / `onblur`.
2. `viewContext` `$derived`:
   `{ panel: panel && { ...panel, editing: panel.kind === 'node' ? editing : undefined, field: focusedField ?? undefined }, highlighted: highlight, dataset: getDataset(datasetId).title }`.
   Strip `undefined` before sending (JSON.stringify does).
3. `send()` body (`App.svelte:42`): add `context: viewContext`.
4. Focus timing: sending a message moves focus to the chat textarea, which fires `onblur` on
   the editor field before `send()` runs. Capture `lastFocusedField` with a 1.5 s expiry so a
   field the user was just in still counts. Reset it on panel change.

## Phase 3 — Service

1. `service/index.js:24`: destructure `context = null`. Sanitise per Decision 3: `panel.id`
   must exist in `tree.nodes` (kind `node`) or `company.units` (kind `team`); `highlighted`
   filtered against the tree.
2. `service/prompt.js:21` `systemPrompt(tree, company, selectedNodeId, context)`: replace
   `:31-35` with a `## What the user is looking at` section rendered from context, e.g.
   `Dataset: "Workflow platform, FY26". Selected node: "Improve our social media presence" (kr). The node's edit panel is open and the cursor is in the metric field. Nodes highlighted from your last reply: "Redesign the settings page", "Attend more industry events".`
   followed by the resolution rules from Decision 4 as a short bullet list. When nothing is
   open, keep the current "No node is currently selected." line.
3. `[chat]` log line (`service/index.js:58-60`): append `· ctx=<kind>:<id>/<field>` for
   debugging prompt behaviour.

## Phase 4 — Prompt tuning

1. Two example resolutions in the prompt, one for a focused field ("what should this be?" with
   the cursor in `target` means propose a target for that node) and one for highlights ("fix
   those" means edit the highlighted set).
2. Run the verification transcript below after each prompt change; keep the transcript in the
   plan's completion notes.

## Verification

- Select `kr-7`, open Edit, focus `metric`, ask "what should this be?": the reply proposes a
  metric for that KR and `highlight` includes `kr-7`; no action unless asked.
- Ask the weak-KR question, then "move those under Sales": `relink` actions on exactly the
  highlighted set.
- Open Marketing's team editor, ask "what does this team own?": the reply lists Marketing's
  nodes; `highlight` equals them.
- Teams list open, nothing selected, ask "who owns the most KRs?": answered from `company`.
- Service: a request whose `context.panel.id` is unknown → 200, log shows it dropped.
- Existing fixtures and `chat-request.no-optionals.json` still validate.

## Out of scope

- Tabs, modes and subjects (`CHAT_TABS_AND_INTERVIEWS`).
- Sending the undo stack, the chat history of other tabs, or the camera position.
- Hover state as context.
