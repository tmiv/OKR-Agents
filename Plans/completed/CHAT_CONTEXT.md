---
tags:
  - plan
  - web
  - service
  - schema
  - chat
status: completed
created: 2026-09-11
completed_on: 2026-09-11
predecessors:
  - completed/OKR_NODE_EDITOR.md
  - completed/TEAM_MODEL_AND_EDITOR.md
successors:
  - completed/CHAT_TABS_AND_INTERVIEWS.md
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

## Completion notes

**Planned vs. actual.** The four phases landed as written. The schema gained `context` beside
`selectedNodeId` with `definitions.viewContext` / `definitions.openPanel`
(`schema/src/chat-request.schema.json:33-36,104-176`), `App.svelte` grew one `viewContext`
`$derived` that every request reads, the service sanitises rather than rejects, and the prompt
renders a `## What the user is looking at` section in labels. Nothing in the Decisions block had
to be reopened.

**Mid-flight adjustments.**
- *Where the sanitiser lives.* Phase 3 put it in `service/index.js`; it went into
  `service/validate.js` as `sanitizeContext()` instead, next to `validateResponse()`. That file
  already owns "shape lives in the package, reference checks against *this* tree live here", and
  this is exactly a reference check. `index.js` calls it and logs what was dropped.
- *`panel.id` for node panels.* Phase 2 spelled the builder as `{ ...panel, editing, field }`,
  which for a node panel carries no id (`panel` is the bare `{ kind: 'node' }` slot). Decision 3
  assumes an id to check, so the builder fills it from `selectedId`. The context is now
  self-describing without cross-reading `selectedNodeId`.
- *Field names.* `TeamEditor` names its fields the way the `editUnit` action does
  (`charter.mission`). The schema enum is the plain names from Decision 2, so `focusField()`
  strips the `charter.` prefix in one place rather than renaming the editor's callbacks.
- *The 1.5 s expiry became a rule about where focus went.* The plan's reasoning was right — blur
  fires before `send()` — but 1.5 s only covers pressing Send straight from the field. Anyone who
  clicks the chat box and *types* a question is past it before they finish. So blur now looks at
  where focus landed on the next tick: into the chat composer and the field is held (until
  another field, another panel, or another selection takes it); anywhere else and the plan's
  1.5 s expiry runs. Verified in the browser with a 72-character message typed over several
  seconds — `field: "metric"` still arrived.
- *The view block moved to the end of the system prompt.* Phase 4 tuning: with the section sitting
  between `<teams>` and `## How to respond`, "what does this team own?" with Marketing's charter
  open still came back "Which team did you mean?" twice. Moved last, right after the coaching
  line and closest to the user's message, and it resolves. The pronoun bindings were also pulled
  onto the fact lines themselves (“…so ‘this team’, ‘the team’ and ‘we’ mean Marketing”)
  rather than living only in the rules list below.
- *Hover preview is not sent.* `preview` (the transient panel-link hover highlight that landed in
  `616aea4`) stays out of the context, per Out of scope. It is gone by the time the user presses
  Send — releasing the mouse to reach the chat box clears it — so it would only ever arrive empty,
  or worse, stale.

**Surprises / residual risks.**
- *The verification transcript lied for three model calls.* The service's `node --watch` had
  silently stopped reacting to edits on the Docker bind mount, so the first two attempts at the
  Marketing check were scoring a stale prompt — identical replies word for word, and an unchanged
  input-token count, were the tell. Restarting the service fixed it. If a prompt change ever looks
  like it did nothing, check `in`-token count in the `[chat]` line before rewriting the prompt.
- *The model confirms before doing something it thinks is wrong.* "Move those under Sales" resolves
  the pulsing set correctly and names all of it back, but asks before relinking a settings-page
  redesign under Sales. One "yes, all of them" later the `relink`s land on exactly the highlighted
  set and nothing else. That is coaching behaviour, not a context failure — but a stricter reading
  of this plan's second verification bullet needs the extra turn.
- *Highlights can be a justified superset.* "What does this team own?" on Marketing highlights
  Marketing's four nodes plus the two owned by Content and Field Marketing, which roll up under
  Marketing, and the reply says so. The bullet asked for equality; the model's answer is better
  than the bullet.
- *A node panel with no selection drops.* `sanitizeContext` requires an id for `kind: 'node'`, so
  a node panel that somehow has no selected node is dropped whole and logged. That combination
  should not occur — `select()` only opens a node panel for a real id — but it is a log line to
  recognise rather than a puzzle.

### Verification transcript

Run against `workflow-platform-fy26` and the live service (real model replies, `claude-sonnet-5`):

| Check | Result |
|---|---|
| `kr-7` selected, edit mode, cursor in `metric`, "what should this be?" | proposes a metric for that KR, `highlight: [kr-7]`, no actions. `ctx=node:kr-7/metric` |
| "which key results are weak?" then "move those under Sales" | names back exactly the five pulsing KRs and asks to confirm; on "yes, all of them" emits `relink` for exactly `kr-4, kr-7, kr-9, kr-13, kr-21`, all to `obj-3` |
| Marketing's charter open, "what does this team own?" | answers from the charter and the tree, highlights Marketing's nodes plus its sub-teams' two, no "which team?" |
| Teams list open, nothing selected, "who owns the most KRs?" | answered from `company` by `unitId`, guesses at no panel |
| `context.panel.id = "no-such-team"`, `highlighted: ["kr-5", "ghost-1"]` | 200; `[chat] context: dropped ["panel team:no-such-team","highlighted ghost-1"]`, `ctx=none` |
| `npm run test:schema` | 115 pass, including the two new fixtures |
| Browser, Marketing charter, cursor in Mission, "what should this say?" | request carries `{"panel":{"kind":"team","id":"marketing","field":"mission"},…}`; reply is about Marketing's mission. `ctx=team:marketing/mission` |
| Browser, `kr-7` in edit mode, cursor in `metric`, message typed over several seconds | request carries `{"panel":{"kind":"node","id":"kr-7","editing":true,"field":"metric"},…}` |
