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
  - development/CHAT_CONTEXT.md
  - completed/TEAM_MODEL_AND_EDITOR.md
---
# Plan: Multiple chat tabs with a mode and a subject, and buttons that open interviews

Concept: [OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md)
(vocabulary: Tab, Interview) and [Teams as Agents - Design](../../Concepts/Teams%20as%20Agents%20-%20Design.md)
(interviews are the on-ramp to personas).

## Context

There is one conversation: `messages` at `web/src/App.svelte:25`, rendered by
`web/src/Chat.svelte`, with history sliced to the last ten turns at `App.svelte:32-35`.
Buttons on a node or a team want to open a focused conversation about that one thing without
polluting the general chat, and an interview needs a different prompt: ask, don't answer.

## Goal

The chat panel has tabs; each tab has a mode (`free`, `interview-node`, `interview-team`,
`interview-new`) and a subject; interview tabs open with the assistant's first question and end
by proposing Actions that go through `commit()`.

## Decisions (locked in)

1. **Tab shape:** `{ id, title, mode, subject, messages, loading }` where `subject` is
   `{ kind: 'node', id } | { kind: 'team', id } | { kind: 'new', parentId: string | null } | null`.
   `chats = $state([])`, `activeChatId = $state()`. Undo stack, highlight and selection stay
   global: there is one scene.
2. **Kick-off turn.** Opening an interview tab sends a synthetic user turn
   `"Begin the interview."` flagged `hidden: true` so the UI does not render it, but it is kept
   in history so the API sees strict user/assistant alternation
   (`service/validate.js:17-24` drops leading assistant turns). (Interview answer: agent asks
   first.)
3. **Request gains `mode` and `subject`**, additive. The response shape and the `respond` tool
   do not change; proposed edits come back as `actions` and are committed like any other.
4. **Interview rules in the prompt:** one question per turn; at most eight questions; reflect
   what you heard in one sentence before asking the next; when you have enough, summarise and
   return `actions`; `highlight` the subject's nodes on every turn. `interview-new` ends with
   `add` under `subject.parentId`; if `parentId` is null, the first question is which objective
   the new node supports. `interview-team` may end with `editUnit` (charter changes) and node
   edits for the team's nodes.
5. **Free tabs use the current prompt unchanged.** Mode only adds a section.
6. **In memory only.** Tabs vanish on reload, like everything else.
7. **Per-tab loading.** Two tabs may have requests in flight; each response lands in the tab
   that sent it, matched by tab id captured at send time.

## Phase 1 — Schema

1. `schema/src/chat-request.schema.json`: add `mode` (enum of the four, default `free` in
   description) and `subject` (`oneOf` the three shapes, or null). Fixtures:
   `valid/chat-request.interview-node.json`, `valid/chat-request.interview-new-no-parent.json`,
   `invalid/chat-request.bad-mode.json`.
2. `schema/index.d.ts`: export `ChatMode`, `ChatSubject`. Rebuild.

## Phase 2 — Web state

1. `App.svelte:25-26`: replace `messages` / `loading` with `chats` and `activeChatId`
   (Decision 1). `const activeChat = $derived(chats.find(c => c.id === activeChatId))`.
2. `send(chatId, message, { hidden = false } = {})`: look up the chat; build `history` from
   its `messages` (same filter/slice as `:32-35`, including hidden turns); push the user turn
   with `hidden`; set `chat.loading = true`; POST with `mode`, `subject`, `context` (from
   `CHAT_CONTEXT`); on response `commit()` actions, set global `highlight`, push the assistant
   turn into that chat. Errors as today (`:63-65`).
3. `newChat({ mode, subject, title })`: creates the tab, makes it active, and for interview
   modes calls `send(id, 'Begin the interview.', { hidden: true })`. Returns the id.
   `closeChat(id)`: remove; if it was active, activate the previous tab; never close the last
   tab (create a fresh free one instead).
4. Boot: one free tab titled "Chat".
5. `recall(ids)` (`:135-137`) unchanged.

## Phase 3 — Chat.svelte

1. Props: `chats`, `activeChatId`, `onSelectChat`, `onCloseChat`, `onNewChat`, `onSend`,
   `onRecall`.
2. Tab bar above `.messages` (`Chat.svelte:33`): one button per tab (title truncated to 24
   chars with the full title in `title`), an `×` on each tab except when only one exists, a
   `+` that opens a small menu: "New chat", "Interview me about a new OKR".
3. Render `activeChat.messages`, skipping `hidden` turns. Suggestions chips (`:7-11`, `:34-41`)
   only in free tabs' empty state; interview tabs show a one-line hint ("The assistant asks,
   you answer. Say 'that's enough' to wrap up.") while the kick-off is loading.
4. Loading indicator (`:59-61`) and disabled input (`:69-71`) keyed on `activeChat.loading`.
5. Assistant turns that carried actions already show an "N edits" pill (`:47-49`); in
   interview tabs also show "Undo" next to it, calling the global undo.

## Phase 4 — Launchers

1. `Detail.svelte` header: "Interview me about this OKR" →
   `onNewChat({ mode: 'interview-node', subject: { kind: 'node', id }, title: 'Interview: <label>' })`.
   In edit mode on an objective or the root, also "Interview me about a new KR here" →
   `interview-new` with `parentId = node.id`.
2. `TeamEditor.svelte` header: "Interview me about this team" → `interview-team`, title
   `Team: <name>`.
3. Chat `+` menu: "Interview me about a new OKR" → `interview-new` with
   `parentId = selected node if its level is objective or company, else null`.
4. `App.svelte`: pass `onNewChat={newChat}` to the panels.

## Phase 5 — Service

1. `service/index.js:24`: destructure `mode = 'free'`, `subject = null`; validate the subject
   id against the tree or `company.units`; an unknown subject downgrades the mode to `free`
   with a log line rather than a 400.
2. `service/prompt.js`: `systemPrompt(tree, company, selectedNodeId, context, { mode, subject })`.
   Add a `## Your role in this conversation` section per mode:
   - `interview-node`: "You are interviewing the user about <label> (<level>, owned by <team>).
     Goal: make it an outcome with a metric and a target, and confirm it supports <parent
     label>." plus Decision 4 rules.
   - `interview-team`: "You are interviewing the user about the <name> team. Goal: fill or
     sharpen its charter (mission, process, what it owns, what it depends on) and check its
     objectives fit." Render the current charter so the model asks about gaps, not what it
     already has.
   - `interview-new`: "You are helping the user define a new OKR under <parent label>" (or the
     ask-for-parent variant).
   - `free`: nothing added.
3. `[chat]` log line: append `· mode=<mode>`.

## Phase 6 — Styles

`web/src/app.css` chat block (`:118-150`): `.tabs` row with overflow-x scroll, active tab
border in `var(--accent)`, `.tab .close`, the `+` menu as a small absolute popover.

## Verification

- Boot: one "Chat" tab; the demo script runs unchanged in it.
- Select `kr-7`, click "Interview me about this OKR": a new tab opens, the assistant asks a
  question within ~3 s, `kr-7` pulses, the kick-off turn is not visible. Answer four or five
  questions; the assistant summarises and returns an `edit`; `kr-7` has a metric and target;
  Undo reverts it; the free tab's messages are untouched.
- Open Marketing's editor, "Interview me about this team": questions target charter gaps; the
  end result is an `editUnit` with `charter` fields; the TeamEditor shows them.
- `+` → "Interview me about a new OKR" with `obj-3` selected: the first question is about the
  KR, not the parent. With nothing selected: the first question asks which objective.
- Send in tab A, switch to tab B and send there before A returns: both replies land in the
  right tabs; the scene highlights the most recent reply.
- Close a tab: the previous tab activates; closing the last tab yields a fresh "Chat".
- Service: `mode: "interview-node"` with an unknown subject id → 200, log shows the downgrade.

## Out of scope

- Persisting tabs. Renaming tabs. Drag-reordering.
- Persona, review and debate modes (`Teams as Agents - Design`; future
  `TEAM_AGENT_DISCUSSIONS.md`). This plan leaves `mode` as an enum so those are additive.
- Streaming.
- An "end interview" button; "that's enough" in text is sufficient for v1.

## Risks / rollback

- The kick-off turn is visible to the model as literal user text; if replies start with "Sure,
  I'll begin the interview" the prompt should say the phrase is a system signal to ignore.
- History cap: `App.svelte:34` sends the last ten turns. An eight-question interview is 16+
  turns, so the summary turn may not see the first answers. Raise the cap to 24 for interview
  tabs (schema allows 50) and keep 10 for free tabs.
- Rollback: `chats` is a superset of `messages`; reverting to a single array is mechanical.
