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
  - completed/CHAT_CONTEXT.md
  - completed/TEAM_MODEL_AND_EDITOR.md
---
# Plan: Multiple chat tabs with a mode and a subject, and buttons that open interviews

Concept: [OKR Agents - Product Vision](../../Concepts/OKR%20Agents%20-%20Product%20Vision.md)
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

## Completion notes

- **Planned vs. actual.** All six phases landed as written, and the shape held: `mode` + `subject`
  on the request, one `send(chatId, …)`, one `## Your role in this conversation` section in
  `service/prompt.js`, launchers in both editors and in the `+` menu. Nothing about the response
  needed to change — an interview closes by returning `actions`, which go through `commit()` like
  any other edit, so undo and history came free. The file:line citations had all drifted (this
  plan was written before its predecessors landed on `main`); the code they named was still where
  the plan said it was, one function down.
- **Mid-flight adjustments.**
  - *`context` is a sibling, not a replacement.* CHAT_CONTEXT shipped between the writing and the
    doing, so the request now carries `context` **and** `mode`/`subject`. They answer different
    questions — what the user is looking at versus what this tab is for — and `roleBlock()` sits
    directly above `viewBlock()` so the view block stays last, which is where it has to be.
  - *The service had its own history cap.* The plan's risk section raised the browser's ten-turn
    slice to 24 for interview tabs but missed `sanitizeHistory(history, maxTurns = 12)` in
    `service/validate.js`, which would have re-truncated it. Both caps are now mode-dependent.
  - *`interview-new` survives a stale parent.* Phase 5 says an unknown subject downgrades to
    `free`. For `interview-new` that throws away a perfectly good interview, so a `parentId` this
    tree does not have is dropped on its own and the interview simply asks which objective it
    supports. `interview-node` and `interview-team` downgrade as planned.
  - *`resolveTab()` lives in `service/validate.js`*, beside `sanitizeContext()` — it is the same
    kind of thing (a reference check against the document that never 400s), and `index.js` stays a
    route.
  - *The `+` popover moved out of the scrolling strip.* `overflow-x: auto` on the tab row clips
    absolutely positioned children vertically too, so the menu was invisible. `.tabs` is now a
    plain flex row holding a scrolling `.strip` and the `+`.
  - *Launch buttons sit directly under the panel header*, not inside it: the header row is a level
    badge and Edit/Close, and a third element wrapped badly at 320px.
  - *App notes land in the active tab.* Undo, import, export and dataset switches write their one
    line into whichever conversation the user is looking at.
- **Surprises / residual risks.**
  - *The kick-off turn never leaked.* Across four interviews no reply began with "Sure, I'll begin
    the interview" — the prompt line that calls the phrase an app signal seems to be enough. The
    risk is still real if the rules move earlier in the prompt.
  - *Prompt ordering held.* The role block above the view block, the view block last: interviews
    resolved their subject and the free tab's "what should this be?" still answers about the
    focused field. No reordering was needed.
  - *One verification bullet is unreachable.* Phase 3.2 hides the `×` on the only tab, so
    `closeChat()`'s "closing the last tab yields a fresh Chat" branch cannot be triggered from the
    UI. The code keeps it as a guard; the bullet is dead as written.
  - *Tabs are in memory only* (Decision 6), so a reload loses an interview mid-flight. That is the
    same deal every other piece of state has today, and it will stop being acceptable at the same
    moment.
  - *`node --watch` stopped picking up `service/` edits* across the Docker bind mount during this
    work — the first `build:schema` removed `dist/` under it and it never recovered. Restarting it
    with the same invocation fixed it; a reply with an identical input-token count is the tell.

### Verification transcript

Run in the browser against `workflow-platform-fy26` and the live service (real model replies,
`claude-sonnet-5`); no stubs.

| Check | Result |
|---|---|
| Boot | one "Chat" tab, suggestion chips; "which key results don't clearly support a company objective?" answers as before |
| `kr-7` selected → "Interview me about this OKR" | new tab "Interview: Improve our …", first question in ~2 s, `kr-7` pulsing, kick-off turn not rendered |
| Four answers, then "that's enough" | one `edit`: label → "Grow social-sourced mid-market demo bookings from 24 to 50 per quarter", metric → HubSpot-attributed social demo bookings, target → "24 → 50 per quarter by Q4", fit 20% → 75%. Weak links 5 → 4 |
| "Undo" pill beside the "1 edit" pill | `kr-7` back to its old label, metric and 20% fit; "Reverted the last change." in that tab; the free tab's two messages untouched |
| Marketing's editor → "Interview me about this team" | first question is about a gap (is MQL→SQL solely Marketing's?), quoting the existing `owns` list rather than re-asking for it. Closes with an `editUnit`: `process` rewritten to the six-week cadence and weekly pipeline council, `partner co-marketing budget` added to `owns`. TeamEditor shows both |
| `+` → "Interview me about a new OKR", `obj-3` selected | first question is about the outcome, not the parent. `mode=interview-new`, `ctx=node:obj-3` |
| Same with nothing selected | first question asks which objective it should support |
| Send in the free tab, switch tabs, send in the interview before the first returns | both replies land in their own tab; the busy tab shows its marker while the other is on screen |
| Close the active middle tab | the previous tab activates; closing down to one leaves no `×` |
| `mode: "interview-node"` with `subject.id = "kr-999"` | 200; `[chat] interview-node: node kr-999 is not in this tree — falling back to free`, then `mode=free` |
| Cursor in `metric` on `kr-7`, then click into the chat composer, "what should this be?" | `ctx=node:kr-7/metric · mode=free` — the CHAT_CONTEXT hold still works with a per-tab composer |
| `npm run test:schema` | 118 pass, including the three new fixtures |
| `npm run build` (web) | clean |
