---
tags:
  - concept
  - product
  - web
  - service
created: 2026-09-11
---
# OKR Viewer - Product Vision

The design rationale behind the September 2026 round of plans. The plans say *what* and *where*;
this doc says *why* and how the pieces fit. Plans that cite this doc:
[BUNDLED_DATASETS](../Plans/completed/BUNDLED_DATASETS.md),
[CAMERA_LEVEL_AUTO_MOVES](../Plans/completed/CAMERA_LEVEL_AUTO_MOVES.md),
[CLEAR_HIGHLIGHT_ON_SELECT](../Plans/completed/CLEAR_HIGHLIGHT_ON_SELECT.md),
[OKR_NODE_EDITOR](../Plans/completed/OKR_NODE_EDITOR.md),
[TEAM_MODEL_AND_EDITOR](../Plans/completed/TEAM_MODEL_AND_EDITOR.md),
[CHAT_CONTEXT](../Plans/completed/CHAT_CONTEXT.md),
[CHAT_TABS_AND_INTERVIEWS](../Plans/completed/CHAT_TABS_AND_INTERVIEWS.md).
Companions: [Teams as Agents - Design](Teams%20as%20Agents%20-%20Design.md),
[Agents as Executors - Design](Agents%20as%20Executors%20-%20Design.md), and
[Depth and Focus - Design](Depth%20and%20Focus%20-%20Design.md) (why the three-level ladder is a
default, not a doctrine, and why focus is the constraint that replaces it).

## The thesis, restated

The README's one-liner still holds: **the model's output is the interface, not a chat log next to
one.** The 3D tree is the shared workspace; the assistant acts on it by moving the camera,
pulsing nodes, and rewriting them. Everything below extends that thesis in one direction: the
user gets more ways to *point at* things (select, edit, open a team), and the assistant gets to
*see* what is being pointed at. Pointing plus seeing is what makes "make this measurable" work
without the user typing an id.

## Three surfaces, one state

| Surface | Owns | Talks to state via |
|---|---|---|
| **Scene** (`Graph.svelte`) | camera, pulse, selection gesture | `onSelect`, `highlight`, `tree` |
| **Panels** (Detail / TeamEditor / TeamList) | one thing at a time, read or edit | `panel` state, `onEdit(action)` |
| **Chat tabs** (`Chat.svelte`) | conversations, each with a mode and a subject | `send(chatId, message)`, `recall(ids)` |

All three read and write the same document-shaped state in `App.svelte`: `{ tree, company,
history }` plus UI state `{ selectedId, highlight, panel, chats }`. There is no second store.

## Invariants (the load-bearing rules)

1. **The service is stateless.** The browser sends the whole document every time. Teams,
   history and view context all ride in the request; nothing is remembered server-side. This is
   what keeps tabs, datasets and undo trivially correct: there is nothing to desync.
2. **One endpoint, one shape, grown additively.** `POST /api/chat` gains optional fields
   (`company`, `context`, `mode`, `subject`). It never gets a sibling endpoint and never bumps
   `schemaVersion` for these additions. A client that sends none of the new fields still works.
3. **Every mutation is an Action through one commit path.** The assistant, the node editor, the
   team editor and interview outcomes all emit Actions from the same schema, and all go through
   `commit(actions, { actor, reason })`, which snapshots for undo and appends to
   `history.changes`. There is no "direct edit" path. Consequence: undo covers everything, history
   is complete, and the model can do anything the UI can.
4. **The document is the unit of truth.** Bundled datasets, exports and imports are all
   `OkrDocument`s. A bundled dataset is just a file someone exported by hand.
5. **The scene never disorients the user on its own.** Programmatic camera moves level to world
   up; user gestures (tumble, click) take precedence over assistant pointers (highlights clear on
   selection). The user always feels in control of the view.
6. **Teams are data the model can be handed.** A team's charter (mission, process, ownership
   domain, dependencies) is written so it can be dropped into a system prompt verbatim. That is
   the bridge to agents; see the companion doc.

## Vocabulary

- **Document**: `{ schemaVersion, meta, company?, tree, history? }`. What is exported, imported,
  bundled.
- **Tree / Node**: the OKR hierarchy. Flat nodes with `parent` pointers. Levels company →
  objective → kr.
- **Team** (schema name: `CompanyUnit`): an org unit with an optional **charter**. Nodes point at
  a team by `unitId`; `owner` is the display string derived from it.
- **Action**: one edit. Node ops `edit | relink | add | delete`; team ops
  `editUnit | addUnit | deleteUnit`.
- **Commit**: applying a batch of Actions with an actor and a reason. Produces one undo step and
  one history change.
- **Selection**: the node the user clicked. **Highlight**: the nodes the assistant pointed at.
  Selection wins; highlight is transient.
- **Panel**: the one thing open on the left of the scene: a node (read or edit), a team, or the
  team list.
- **Context**: what the user is looking at, sent with a message: selection, panel, focused field,
  highlights, dataset.
- **Tab**: one conversation with a **mode** (`free`, `interview-node`, `interview-team`,
  `interview-new`) and a **subject** (a node, a team, or a parent for a new node).
- **Interview**: a tab where the assistant asks, one question at a time, and ends by proposing
  Actions.
- **Persona** (future): a system prompt built from a team's charter so an agent speaks as that
  team.

## Why these pieces, in this order

```
BUNDLED_DATASETS ─┐
CAMERA_LEVEL ─────┼── independent, ship in any order
CLEAR_HIGHLIGHT ──┘
        │
OKR_NODE_EDITOR ── introduces commit() + history
        │
TEAM_MODEL_AND_EDITOR ── company in state/request, team actions, team editor, team labels
        │
CHAT_CONTEXT ── panel/field/highlight context in the request
        │
CHAT_TABS_AND_INTERVIEWS ── modes, subjects, launch buttons
        │
(future) TEAM_AGENT_DISCUSSIONS ── personas, debates, reviews
```

- **Datasets first** because teams need somewhere to live in data, and because every later
  verification step starts with "load dataset X".
- **Editor before teams** because the editor establishes `commit()` and history, which the team
  editor reuses without inventing a second path.
- **Teams before context** because "the open team editor" is one of the things context reports,
  and the request must already carry `company` for the model to name teams.
- **Context before tabs** because an interview about a team is a tab whose subject is that
  team; the context machinery is what makes the subject resolvable.

## Alternatives considered

- **A `/api/interview` endpoint.** Rejected: interviews are the same tool call with a different
  system prompt; a second endpoint would duplicate validation and drift.
- **Team edits outside the Action system** (a `setCompany()` setter). Rejected: interviews about
  a team must be able to propose team edits, and those must be undoable and recorded. One action
  vocabulary or two of everything.
- **Replacing `owner` with a required team reference** (breaking, `schemaVersion: 2`). Rejected
  for now: additive `unitId` with `owner` as derived display text keeps every existing file and
  prompt valid. Revisit when a migration is worth writing.
- **OrbitControls for the camera.** Rejected: it never rolls, but it also forbids the user from
  rolling. The ask was "level on auto-moves, free on user moves".
- **Persisting tabs or the chosen dataset.** Deferred: nothing persists yet; adding persistence
  for one thing invites a half-built persistence layer.

## Horizons

Recorded 2026-09-11 so near-term decisions keep the doors open. Only Horizon 1 has plans.

| Horizon | What | Why it waits |
|---|---|---|
| **1. Interaction model and value** (now) | The seven plans above: datasets, camera, editor, teams, context, tabs. | Everything later assumes the tree, teams and chat are worth using by one person. |
| **2. Agents that work and measure** (mid) | An agent runs *as a team* to execute one of its OKRs through connected tools (e.g. triage 90% of incoming issues on a GitHub repo and rank them by priority). Agents and users both record progress. A progress dashboard reads it. Designed in [Agents as Executors - Design](Agents%20as%20Executors%20-%20Design.md). | Needs a team charter that is real (Horizon 1), a place to run long jobs, and tool connections with credentials. |
| **3. Shared, live document** (distant) | The document lives in a realtime JSON-document database so several team members edit and chat against it at once. | Needs the interaction model settled first; a multi-user store hardens whatever shape it is given. |

Seams to keep open now, because they are cheap today and expensive later:

- **The document is the unit of truth** (invariant 4). A JSON-document realtime store
  (Firestore, Yjs/Automerge, RxDB) can hold an `OkrDocument` as-is; nothing in the app addresses
  state by anything other than the document and the ids inside it.
- **Every mutation is an Action with an actor** (invariant 3). Horizon 2 adds `actor: "agent"`
  and Horizon 3 adds a user identity; both are additive to `history.changes`. Never let a UI
  path bypass `commit()`.
- **`history.metricSamples` already exists** (`schema/src/history.schema.json`). Progress
  tracking by users and agents writes there; the dashboard reads there. Do not invent a second
  progress shape.
- **Team charters are self-contained prose plus lists.** An executor agent's system prompt is
  the charter plus the OKR plus its tool descriptions. A future `connections` field on the unit
  (which repos, which trackers) is additive.
- **The level ladder is a warning in the schema, a rule only in the editor and prompt.** Keep it
  that way so depth can be opened later without a migration; see
  [Depth and Focus - Design](Depth%20and%20Focus%20-%20Design.md).
- **The service is stateless** (invariant 1) until Horizon 3 deliberately changes it. An agent
  that runs for hours cannot live inside a request; that is a new process, not a change to
  `/api/chat`.

## What this round deliberately leaves out

- Multi-agent discussions (designed in the companion doc, not planned).
- Agents executing or measuring OKRs, and dashboards (Horizon 2).
- Shared, persistent, multi-user documents (Horizon 3).
- Teams as objects in the 3D scene beyond an optional label.
- Auth, streaming, mobile (README scope boundary stands).
