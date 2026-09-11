---
tags:
  - concept
  - teams
  - agents
created: 2026-09-11
---
# Teams as Agents - Design

Why teams get a charter now, and what that charter is for later. The near-term plan is
[TEAM_MODEL_AND_EDITOR](../Plans/development/TEAM_MODEL_AND_EDITOR.md); the far-term plan does
not exist yet and would be named `TEAM_AGENT_DISCUSSIONS.md`. Parent vision:
[OKR Viewer - Product Vision](OKR%20Viewer%20-%20Product%20Vision.md).

## The metaphor

A team's charter is a **job description for an agent**. If a human read only the charter, they
should be able to sit in a meeting and argue that team's corner: what it is for (mission), how
it does its work (process), what it is the owner of (ownership domain), and who it needs
(dependencies). Everything the OKR tree says about the team (its objectives, KRs, alignment
scores) is the agenda for that meeting; the charter is the person attending.

So the charter is written *for a prompt*, in the same way every schema description is written
for the model (the schema plan's rule). Field descriptions say "in the team's own words", and
the editor shows placeholder text that reads like a persona, not like a form.

## Charter shape

```
charter: {
  mission:   "why the team exists, one or two sentences",
  process:   "the business process it runs: inputs, steps, outputs, cadence",
  owns:      ["systems, metrics or decisions this team is the accountable owner of", ...],
  dependsOn: ["unit-id", ...]   // teams whose output this team needs
}
```

- `mission` and `process` are prose because personas are prose.
- `owns` is a list because ownership disputes ("who owns activation rate?") are the most
  interesting thing two team agents can argue about, and a list is diffable.
- `dependsOn` is references because reviews ("does Sales' KR depend on something Engineering has
  not committed to?") need to walk a graph, not parse text.

## The four discussion modes (interview answer, 2026-09-11)

All four were chosen. In dependency order:

1. **Chat with one team's agent.** A tab with `mode: 'persona'`, `subject: team`. The system
   prompt is the coach prompt plus "You are speaking as <team>. Here is your charter. Answer as
   this team would, from its priorities and constraints." Cheapest; a direct extension of
   interview tabs.
2. **Agents review each other's OKRs.** Team A's persona is asked to critique Team B's subtree
   for alignment, measurability and unstated dependencies on A. Output is a normal reply +
   highlight, optionally actions. One call per review.
3. **Team-vs-team debate the user moderates.** N personas, one shared transcript, the user picks
   the topic and can interject. Because the service is stateless, the *browser* orchestrates:
   each turn is one `/api/chat` call with `mode: 'persona'`, the speaking team as subject, and
   the shared transcript as history (turns attributed by name in the content). A tab shows the
   transcript with speaker labels.
4. **Agents negotiate and propose tree edits.** Mode 3 with a closing turn: a neutral "coach"
   call that reads the transcript and returns `actions`. Actions go through `commit()` like
   everything else, so the user can undo the whole negotiation in one step.

## Invariants the near-term plan must not break

- **The charter is self-contained.** No field may depend on UI state or on another document.
  A charter pasted into a prompt with the team's subtree must be enough.
- **Team edits are Actions.** Modes 1 to 4 will propose charter changes; they must be undoable
  and land in history like node edits.
- **A team can be handed to the model without its people.** `people` stays optional and out of
  the persona; personas represent teams, not individuals.
- **`owner` never disagrees with `unitId`.** The apply layer derives `owner` from the unit name
  whenever `unitId` changes, so prompts that read `owner` and prompts that read `unitId` agree.

## Alternatives considered

- **Personas as a separate `agents` section in the document.** Rejected: it would drift from the
  team it describes. The charter *is* the persona source; a future `persona` field on the unit
  (tone, red lines) can be added additively if needed.
- **Server-side orchestration of debates** (a `/api/discuss` endpoint that loops). Rejected for
  now: it breaks the stateless invariant and hides turns from the user. Browser-driven turns
  keep each call inspectable and interruptible. Revisit if latency of N sequential calls is
  unacceptable.
- **Free-text `domain` instead of `owns[]`.** Rejected: ownership overlap detection between two
  teams is the first useful agent argument, and it needs discrete items.

## Open questions for the future plan

- Should a debate transcript be exportable into `history`? Probably as a `change` with empty
  actions and the transcript as `reason`, but the 4000-char `reason` cap may be too small.
- Does mode 3 need a "moderator" persona, or is the user enough?
- Rate limits: N personas × M turns per debate; a debate of four teams and six rounds is 24
  calls at ~3 s each.
