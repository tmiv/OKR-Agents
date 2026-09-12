---
tags:
  - plan
  - web
  - service
  - schema
  - chat
  - agents
status: completed
created: 2026-09-12
completed_on: 2026-09-12
predecessors:
  - completed/CHAT_TABS_AND_INTERVIEWS.md
  - completed/CHAT_CONTEXT.md
  - completed/FRAME_NODE_NEIGHBORHOOD.md
---
# Plan: Audit the tree unprompted and show the findings as a Briefing panel the user acts on

## TL;DR
The assistant reads the whole tree without being asked, on load and after every change, and
returns 3–6 ranked findings; a Briefing panel shows them as cards the user can preview on hover,
fly to, fix in one click through `commit()`, or dismiss. One new request mode (`audit`), one
optional response field (`findings[]`), one prompt block, one panel component, one `$effect`
trigger. Single repo, three packages (`schema/`, `service/`, `web/`). Out: rule-based findings,
persistence, discussion modes 2–4, progress. Stretch: an "Ask <team>" button on a card that opens
a persona chat with the owning team.

Concept: [Depth and Focus - Design](../../Concepts/Depth%20and%20Focus%20-%20Design.md) (the
product's job is keeping the tree honest and small; audit on change, not on schedule; AI drafts,
humans decide) and [OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md)
(the model's output is the interface). The stretch phase is mode 1 of
[Teams as Agents - Design](../../Concepts/Teams%20as%20Agents%20-%20Design.md).

## Context

The assistant only ever answers. Every call to `/api/chat` starts with a user typing, and the
three chat chips (`web/src/Chat.svelte:34-38`) are the only hint that the tree might have
something wrong with it. The topbar counts weak links by a rule (`web/src/App.svelte:155`), which
catches low `contributes` and nothing else: not an activity dressed as a KR, not a target with no
baseline, not a team carrying nine KRs, not an objective with no KRs under it.

Polaris has 135 nodes and 61 teams (`web/src/assets/datasets/polaris-group-fy26.json`). Nobody
reads that. The claim this project makes is that the model absorbs the reading so a person can
hold three to five priorities; today the app does not demonstrate that claim, because the
reading only happens when asked.

Everything needed to demonstrate it exists: one endpoint with a `mode`
(`schema/src/chat-request.schema.json:56`), a response the service filters against the tree
(`service/validate.js:122-261`), preview-on-hover from a panel (`web/src/TeamList.svelte:29-35`),
`flyTo` (`web/src/Graph.svelte:183`), and `commit()` with an actor and a reason
(`web/src/App.svelte:188-212`) so any fix is undoable and lands in history.

## Goal

When a document loads, and after every change to it, the assistant audits the tree without being
asked and the user sees a ranked list of three to six findings, each of which they can look at,
fix in one click, or dismiss.

## Decisions (locked in)

1. **An audit is a request mode, not a tab.** `mode: 'audit'` joins the `chatMode` enum. The
   request carries the usual document, `message: 'Audit the tree.'`, empty `history`, no
   `subject`. The service does not know or care that no conversation exists. A fifth endpoint
   was rejected by invariant 2 of the vision doc; a fifth tab was rejected because a briefing is
   read at a glance, not talked in.
2. **The response grows one optional field, `findings[]`.** Additive; `required` at
   `schema/src/chat-response.schema.json:34` does not change, so every fixture and client still
   passes. Shape:
   ```
   findings: [{
     title:    string (1–80)        // "Three Marketing KRs describe activities, not outcomes"
     why:      string (1–300)       // one or two sentences the user reads on the card
     severity: 'high' | 'medium' | 'low'
     nodeIds:  string[] (1–20)      // what to preview, highlight and fly to
     fix:      Action[] (0–20)      // optional; empty when the fix is a judgement call
   }]  // maxItems 8
   ```
   The browser reads `findings` only from a response to an audit request. A model that returns
   findings in a free conversation is harmless and ignored.
3. **Each fix is validated on its own, against the tree as sent.** The user applies findings one
   at a time in any order, so a fix may not depend on another finding's fix having landed. The
   action loop in `validateResponse` becomes a reusable `validateActions(tree, company, actions)`
   and runs once per finding with fresh `known` / `parentOf` sets. A finding whose `nodeIds` all
   fail to resolve is dropped; a finding whose `fix` actions all drop keeps its card and loses its
   Fix button. No fix may contain `delete` or `deleteUnit`; the prompt forbids it and the
   validator strips it.
4. **One trigger: the document changed.** A `$effect` in `App.svelte` that reads `tree` and
   `company` schedules an audit 1500 ms later. Both are `$state.raw`, so identity changes on
   every commit, undo, reset, switch and import, and the effect fires on mount. A sequence number
   captured at send time discards any response that lands after a newer audit was scheduled, and
   an `AbortController` cancels the in-flight fetch. No call site has to remember to re-audit.
5. **The briefing is a fourth panel kind.** `panel = { kind: 'briefing' }` in the one panel slot
   (`web/src/App.svelte:91`), rendered by a new `Briefing.svelte` styled as `.detail` like
   `TeamList`. It opens by itself the first time an audit of a document returns at least one
   finding, and only if no panel is open: a node the user has clicked is never pushed aside. It
   reopens from the topbar.
6. **The topbar stat becomes the button.** `N weak links` at `web/src/App.svelte:544` becomes
   `Reviewing…` while an audit runs, `N to review` when it is ready, and falls back to the
   rule-based weak-link count when the service cannot be reached. The rule does not go away; it
   is what the app shows when the model cannot.
7. **A card's three verbs are Show, Fix, Dismiss.** Hover previews the finding's nodes exactly
   as a team row does. Show sets `highlight` to `nodeIds` (the existing `recall()`) and calls
   `graph.flyTo(nodeIds)`. Fix calls `commit(fix, { actor: 'assistant', reason: `${title}. ${why}` })`,
   so undo and history come free and the re-audit that follows shrinks the list. Dismiss hides
   the card for the life of this document, keyed by its sorted `nodeIds`; `resetSession()` clears
   dismissals.
8. **The audit prompt names the categories, ranks by impact, and fixes only what is mechanical.**
   Making a KR measurable, relinking to the objective it really supports, correcting
   `contributes`, assigning a `unitId`: these get a `fix`. "This team has nine KRs, which three
   matter?" gets no fix and a `why` that asks the question. That is the focus budget from the
   concept doc, delivered as a finding rather than a counter.
9. **`max_tokens` rises to 8192 for audit requests only.** Six findings with fixes is more than a
   reply; every other mode keeps 4096 (`service/index.js:83`).

## Phase 1 — Schema

1. `schema/src/chat-request.schema.json:56`: add `"audit"` to the `chatMode` enum and extend its
   description: "audit: no user question; read the whole tree and return `findings`."
2. `schema/src/chat-request.schema.json:181`: add `"briefing"` to the `openPanel.kind` enum so
   the view context can say the panel is open (`sanitizeContext` at `service/validate.js:53`
   already passes through a kind that needs no id).
3. `schema/src/chat-response.schema.json:23-33`: after `highlight`, add `findings` with a
   `$ref` to a new `definitions.finding` carrying the shape in Decision 2. Every description is
   written for the model, per the schema plan's rule: `why` is "what the user reads on the card,
   one or two sentences, no ids"; `fix` is "the actions that resolve this finding on their own,
   or empty when the resolution is a judgement the user must make". `fix` items `$ref`
   `action.schema.json` like `actions` does.
4. The build (`schema/scripts/build.mjs:185-219`) flattens the response into
   `RESPOND_INPUT_SCHEMA` and regenerates `dist/types.d.ts` (`:94`); a `Finding` type appears
   without a hand edit. Re-export it from `schema/index.d.ts:20,57` beside `ChatResponse`.
5. Fixtures (`schema/test/fixtures/`): `valid/chat-response.with-findings.json` (two findings,
   one with a fix, one without), `valid/chat-request.audit.json` (mode audit, no subject, empty
   history), `invalid/chat-response.finding-without-title.json` (`at: "/findings/0"`),
   `invalid/chat-response.finding-bad-severity.json`. `npm test` in `schema/` stays green.

## Phase 2 — Service

1. `service/validate.js:87-120` (`resolveTab`): before the fall-through at `:119`, accept
   `mode === 'audit'` with `subject: null`. An audit never has a subject to lose.
2. `service/validate.js:122-261` (`validateResponse`): lift lines `:150-248` into
   `validateActions(tree, company, actions)` returning `{ actions, dropped }`; `validateResponse`
   calls it once for `input.actions`. Then, for each `input.findings[]` entry (cap 8):
   - keep `nodeIds` that exist in the tree; drop the finding if none survive;
   - clamp `title`/`why` to the schema lengths, default `severity` to `medium`;
   - run `validateActions` on `fix` with fresh sets, strip `delete` / `deleteUnit`, and keep
     whatever survives;
   - report every drop through the existing `dropped` array so `service/index.js:99` logs it.
   Return `findings` beside `reply`, `actions`, `highlight` at `:261`.
3. `service/index.js:83`: `max_tokens: tab.mode === 'audit' ? 8192 : 4096`. `:104-107`: add the
   findings count to the log line and `findings: out.findings` to the JSON. The no-tool-call
   fallback at `:95` sends `findings: []`.
4. `service/prompt.js:145-218` (`roleBlock`): before `return ''` at `:218`, an `audit` block:
   - "You are not answering a question. Read the whole tree and the teams and report what most
     needs a person's attention. Return 3–6 `findings`, ranked by impact on the company
     objective, highest first."
   - the categories to look for: KRs with no metric or no baseline in the target; activities
     written as KRs; `contributes` below 0.4 or plainly wrong given the labels; objectives with
     no KRs; nodes with no team; a team owning more than five KRs; a KR that depends on another
     team's work that has no KR of its own (read `dependsOn`).
   - "Group by problem, not by node: one finding may name several nodes. `fix` only when the
     actions resolve the finding without a decision from the user; a fix never deletes. `reply`
     is one sentence on the state of the tree. `highlight` is the `nodeIds` of your first
     finding."
   - The block sits where the interview blocks sit, above the view block, for the reason the
     comment at `:220-227` gives.
5. `service/prompt.js:98-101` (`viewBlock`): a `briefing` panel line: "The briefing panel is
   open, listing what you found wrong with the tree on the last audit." Free conversations
   started from a card can then say "fix the second one".
6. `service/prompt.js:239-243` ("How to respond"): one line, "`findings`: only in an audit; leave
   it out otherwise."

## Phase 3 — Web: audit state, trigger and the Briefing panel

1. `web/src/App.svelte` near `:155` (`weakLinks`): audit state.
   ```
   let briefing = $state.raw({ status: 'idle', findings: [], seq: 0 });  // idle | running | ready | error
   let dismissed = $state.raw(new Set());
   let auditTimer, auditAbort;
   ```
   `audit()` builds the same body `send()` builds at `:283-292` with `mode: 'audit'`,
   `message: 'Audit the tree.'`, `history: []`, `subject: null`; on success it reads
   `validateChatResponse(...).value.findings ?? []`, sets `status: 'ready'`, and opens the panel
   per Decision 5. It never touches `highlight`, `chats` or `commit()`: an audit is a reading,
   not a reply, and nothing goes into history until the user clicks Fix. On a failed fetch it
   sets `status: 'error'` and keeps the previous findings.
2. The trigger (Decision 4), beside the panel effect at `:93-98`:
   ```
   $effect(() => { tree; company; scheduleAudit(); });
   ```
   `scheduleAudit()` clears `auditTimer`, aborts `auditAbort`, sets `status: 'running'`, and
   arms a 1500 ms timer around `audit()`. The `seq` check makes late responses harmless.
3. `resetSession()` at `:373-384`: `dismissed = new Set()` and `briefing = { status: 'idle',
   findings: [], seq: briefing.seq }`. The effect in step 2 re-audits because `tree` changed.
4. `viewContext` at `:164-171`: `{ kind: 'briefing' }` needs no special casing; it already
   forwards `kind` for anything without an id.
5. New `web/src/Briefing.svelte`, modelled on `TeamList.svelte`:
   - props `{ briefing, dismissed, tree, company, onShow, onFix, onDismiss, onClose,
     onNewChat = null }`;
   - `<aside class="detail briefing">` with the `TeamList` header shape (`:38-44`);
   - one card per finding not in `dismissed`: a severity dot (`--bad` / `--objective` / `--muted`),
     `title`, `why`, and the owning team(s) derived from `nodeIds` through `unitName()`;
   - the row spreads `hover(nodeIds)` (`TeamList.svelte:29-35`) so hovering previews;
   - buttons in `.actions` (`app.css:169`): **Show**, **Fix** only when `fix.length`, **Dismiss**;
   - `status === 'running'` shows the `.hint` "Reviewing the tree…" above whatever findings are
     already there, so a re-audit after a fix does not blank the panel; `ready` with nothing left
     says "Nothing needs attention."; `error` says the service is unreachable and offers a Retry.
6. `web/src/App.svelte:567-612`: a fourth branch in the stage markup:
   ```
   {:else if panel?.kind === 'briefing'}
     <Briefing {briefing} {dismissed} {tree} {company}
       onShow={(ids) => { recall(ids); graph?.flyTo(ids); }}
       onFix={(f) => commit(f.fix, { actor: 'assistant', reason: `${f.title}. ${f.why}` })}
       onDismiss={(f) => (dismissed = new Set([...dismissed, keyOf(f)]))}
       onRetry={scheduleAudit}
       onClose={() => (panel = null)} />
   ```
   `keyOf(f)` is `[...f.nodeIds].sort().join('|')`.
7. `web/src/App.svelte:541-545`: the stat becomes a button that toggles
   `panel = panel?.kind === 'briefing' ? null : { kind: 'briefing' }`, with `class:on` like the
   Teams button at `:553` and text per Decision 6. Keep `.topbar .stats .warn` (`app.css:59`)
   for the fallback count; add a `.busy` state that reuses the blinking dot from
   `.tab.busy .name::after` (`app.css:243`).
8. `web/src/app.css` after `:191`: `.detail .finding` (card spacing, a 3 px left border in the
   severity colour) and `.detail .finding .why` (muted, 12 px). Nothing else is new; the card
   reuses `.detail h3`, `.actions`, `.hint`, `.count`.

## Phase 4 — Stretch: ask the team

Mode 1 from the Teams as Agents doc, launched from a finding so the demo goes "the model found
this, now hear the team's side".

1. `schema/src/chat-request.schema.json:56`: add `"persona"`; subject is `{ kind: 'team', id }`.
2. `service/validate.js:100-104`: `persona` resolves exactly like `interview-team`.
3. `service/prompt.js` `roleBlock`: a `persona` block: "You are speaking as <team>. Here is your
   charter. Answer as this team would, from its priorities and constraints; say 'we'. You may
   propose actions on your own nodes only." Charter prose is dropped in verbatim, which is what
   the charter was written for.
4. `web/src/App.svelte:335-342` (`newChat`): interviews send the hidden kick-off; a persona tab
   sends an `opening` message the caller passes, visible. Signature grows `{ opening }`.
5. `Briefing.svelte`: when a finding's nodes resolve to exactly one team with a charter, an
   **Ask <team>** button calls
   `onNewChat({ mode: 'persona', subject: { kind: 'team', id }, title: `As ${name}`,
   opening: `The briefing says: ${title}. ${why} How does your team see this?` })`.
   Only when the stretch lands; the button is absent otherwise, and `Briefing` takes
   `onNewChat = null` like `Detail.svelte:18` does.

## Verification

- `schema/`: `npm run build && npm test` green with the four new fixtures; `dist/types.d.ts`
  has one `Finding` type and no suffixed duplicate (the build's own check at
  `scripts/build.mjs:118`).
- `service/`: with `polaris-group-fy26.json` as the body and `mode: 'audit'`, `curl` returns 3–6
  findings, every `nodeIds` entry exists, no fix contains a delete, and the log line reports the
  findings count. A second call with `mode: 'free'` and the same tree returns no `findings` key
  or an empty one.
- `web/` (dev server, browser):
  1. Load Polaris. The stat reads "Reviewing…", then "N to review", and the Briefing opens with
     N cards, high severity first.
  2. Hover a card: its nodes bloom white. Click Show: the camera flies and the nodes pulse red.
  3. Click Fix on a measurability finding: labels change in the scene, history gains a change
     with `actor: 'assistant'`, the panel says "Reviewing…", and the list comes back one shorter.
  4. ⌘Z: the tree snaps back and the finding returns on the next audit.
  5. Dismiss a card, fix another: the dismissed one stays hidden. Switch to Starter: dismissals
     and findings clear, a fresh audit runs on the 9-node tree.
  6. Click a node while the Briefing is open: the node panel replaces it (one panel slot); the
     stat button brings the Briefing back.
  7. Stop the service: the stat falls back to "N weak links", the panel says the service is
     unreachable, Retry re-arms the audit. Nothing throws in the console.
  8. Send "fix the second one" in a free chat with the Briefing open: the reply resolves it.
- Stretch: Ask Marketing from a finding opens a tab titled "As Marketing" whose first visible
  message is the finding and whose reply says "we".

## Out of scope

- Rule-based findings computed in the browser without the model. The weak-link count stays as
  the fallback and nothing more.
- Persisting dismissals or findings across reloads; nothing else persists either.
- Discussion modes 2–4 (reviews, debates, negotiated edits). Mode 1 is the stretch here only
  because a finding is the natural opening line.
- Progress, `metricSamples`, and any dashboard (Horizon 2).
- Streaming the audit. One call, one JSON, like everything else.
- Auditing on a schedule. The trigger is a change to the document, per the concept doc.

## Risks / rollback

- **Latency.** A 135-node audit with fixes may take 10–15 s on Sonnet. The panel never blocks:
  old findings stay visible under "Reviewing…", and the user can keep chatting. If it is too slow
  on stage, drop `max_tokens` back and ask for four findings.
- **Cost.** One call per commit. The 1500 ms debounce collapses an interview's closing batch and
  a burst of editor keystrokes (each field commit) into one audit; the abort drops the rest. If
  it is still too chatty, gate re-audits behind the Fix button and a manual Retry.
- **Fix quality.** A fix is only as good as the model's reading, which is why every fix is a
  commit the user made and can undo, and why fixes never delete. The per-finding validation
  (Decision 3) means a bad id in one fix cannot poison another.
- **Rollback.** Every change is additive: remove the `$effect`, the panel branch and the stat
  button, and the schema field, mode and prompt block are dead but harmless.

## Completion notes

**Planned vs. actual.** All four phases landed, stretch included, essentially as written. The
three load-bearing bets held: `mode: 'audit'` needed no new endpoint and no new tab; `findings[]`
was additive enough that `required` never changed and every existing fixture stayed green; and
the one `$effect` on `tree` / `company` really is the only trigger — undo, reset, dataset switch,
import, a Fix click and an edit from a chat tab all re-audit without any call site knowing about
the briefing. Lifting the action loop into `validateActions(tree, company, actions)` (Decision 3)
was the cheapest part of the whole plan and bought per-finding isolation exactly as predicted; it
returns `known` alongside `actions`/`dropped` so `validateResponse` can still filter `highlight`
against the tree the actions leave behind.

**Mid-flight adjustments.**
- **`findings` is in the tool schema only for an audit.** This is the one change that matters.
  With `findings` present in every mode's `input_schema`, ordinary conversational messages came
  back as a `respond` call carrying `{"fields": {}}` and no `reply` — reproducibly, three times
  in three on the same input that answered fine at HEAD. Bisecting the schema showed the trigger
  was the presence of `findings` itself, not its `fix` (the duplicated Action union), and not any
  one of its properties. `RESPOND_TOOL` became `respondTool(mode)` in `service/prompt.js:29`, and
  the general "How to respond" bullet about `findings` went away with it: a mode whose schema
  cannot express findings should not be told about them. Same lesson caught the persona block a
  second time — a line reading "No `findings`. Nobody asked us to audit anything." made *that*
  mode emit `{"fields": {}}` about one call in three, and deleting it took persona to 5/5. Naming
  a field the tool schema does not have is what breaks these calls.
- **The audit prompt had to be told that a missing baseline still gets a fix.** The first draft
  followed Decision 8 but paired it with "never invent a number", and the model read the two
  together as "no baseline, no fix": six good findings, zero Fix buttons. Rewriting it so
  measurability *always* carries a fix — rewrite the label, set the `metric`, and write the
  `target` as the measurement that has to be taken — got fixes on the mechanical findings without
  a single invented number.
- **Titles and `why` clamp on a word boundary.** The model overruns 80 characters often enough
  that a hard `slice()` produced cards ending "…yet it's the w". `clamp()` in
  `service/validate.js` cuts back to the last space and adds an ellipsis.
- **Severity colours are `--bad` / `--meh` / `--muted`**, not `--bad` / `--objective` / `--muted`
  as Phase 3.8 had it. Amber for medium is the app's existing severity vocabulary (`tone()` in
  `Detail.svelte`); blue next to red reads as a category, not a rank.
- **`keyOf` lives in `web/src/lib/briefing.js`** rather than inline in `App.svelte`, because
  `Briefing.svelte` needs the same identity for its `{#each}` key and its dismissal filter.
- The trigger effect wraps `scheduleAudit()` in `untrack()`. It writes `briefing`, which it must
  not then depend on.

**Surprises / residual risks.**
- **A re-audit after a Fix does not come back one shorter.** Verification step 3 assumed it
  would; what actually happens is that the fixed problem leaves and the next-ranked one arrives,
  so the count holds at 5–6 on a tree with more than six problems. The list is a ranked window,
  not a queue — worth knowing before demoing it as a burn-down.
- **"Ask &lt;team&gt;" is rarer than Phase 4 assumed.** The prompt tells the model to group by
  problem, and problems cross teams, so most findings name two or three and the button is
  correctly absent. Roughly one finding in six on the bundled datasets resolves to a single
  chartered team. If it needs to be more common, the gate is `askable()` in `Briefing.svelte`,
  not the prompt — widening the prompt would cost the grouping that makes the cards readable.
- **Latency is as feared**: 15–20 s for Polaris (135 nodes, ~33k input tokens), 8–15 s for the
  small trees. The panel never blocks and the old cards stay up under "Reviewing the tree…", so
  it reads as a background read rather than a wait, but a demo should load the document before
  the audience is looking at it.
- **Cost is one audit per commit**, debounced at 1500 ms. An interview's closing batch collapses
  into one; a burst of Detail-panel field commits does too. Still the obvious thing to gate if
  this gets expensive.
- The service's no-`reply` fallback ("I couldn't come up with an answer for that") is now the
  only thing standing between a malformed tool call and a blank panel. It predates this plan and
  was never exercised until the schema change above started triggering it; a retry-once would be
  a cheap follow-up.
