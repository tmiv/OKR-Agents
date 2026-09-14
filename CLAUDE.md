# Workspace: plans and concepts

Most non-trivial work in this workspace flows through a written plan in `Plans/`. The plan is the
design artifact, the execution guide, and the future-proof record. Treat it as load-bearing.
Design rationale lives separately in `Concepts/`: the concept doc is the *why* (metaphor,
alternatives considered, invariants); the plan is the *what* (phases, file:line edits,
verification). Don't fuse them when they want to be separate.

## Directory layout

```
Concepts/        design docs — rationale, vocabulary, alternatives considered
Plans/
  development/   active or partly-implemented plans
  completed/     finished plans (durable record)
  followups/     post-completion polish, perf, risk items split out from a parent plan
  aborted/       shelved/discarded plans, with the why
```

No plan files at `Plans/` root. Anything authored or in progress belongs in `development/`. When
work lands, move it to `completed/`. Concept docs stay in `Concepts/` regardless of their plan's
status; a plan and its concept doc link to each other in their opening lines.

## Filenames

- Plans: `SCREAMING_SNAKE_CASE.md`. One word per concept, joined by `_`. Be descriptive.
- Concept docs: `Title Case - Design.md` (e.g. `Agent Bonsai - Design.md`).
- Don't use sequence numbers as the only differentiator (`FOO.md` / `FOO001.md` is the
  anti-pattern). If a project has phases or modes, name what differs
  (`BONSAI_CORE.md`, `BONSAI_WEB.md`).
- If a plan is scoped to an issue or work node, include the id in the filename
  (`BONSAI_ISSUE_042_SAP_LIMITS.md`).

## Plan template

Open every plan with frontmatter, then the standard sections; skip a section only when it
genuinely doesn't apply:

```markdown
---
tags:
  - plan
  - <topic tags: agents, org, tooling, etc.>
status: development            # development | completed | aborted
created: 2026-MM-DD
completed_on: 2026-MM-DD       # only when status: completed
pr: https://github.com/...     # optional, add when filed
predecessors:                  # optional, plans this builds on
  - completed/FOO.md
successors:                    # optional, plans that supersede this
  - development/BAR.md
---
# Plan: <imperative title>

## TL;DR
*(Required for plans expected to exceed ~15k chars or 400 lines. One paragraph: what changes,
what repos, what's out.)*

## Context
What state is the system in today, and why is this change needed?

## Goal
The single sentence that, if delivered, makes this plan done.

## Repos touched   *(if multi-repo)*
| Repo | Working dir | Role |
|---|---|---|
| `agent-bonsai` | `/src/agent-bonsai` | Core library + CLI |

## Decisions (locked in)
1. **Decision** — Rationale.

## Phase 1 — <name>
Numbered, ordered phases. Each phase independently shippable when possible. Cite exact
`path/to/file.ext:line` for every edit point.

## Verification
How will we know it worked? Tests, smoke checks, invariant checks.

## Out of scope
What this plan deliberately doesn't do, so it doesn't accrete mid-flight.

## Risks / rollback
Optional but encouraged for risky changes.

## Completion notes   *(filled in at completion)*
Required when the plan took more than ~half a day to land. Three bullets:
- Planned vs. actual: what worked as written.
- Mid-flight adjustments: what we changed and why.
- Surprises / residual risks: what we didn't expect; what's still risky.
```

## Practices that earn their keep — keep doing these

- **Phase-first.** Context → Goal → Decisions → numbered Phases → Verification → Out of scope.
  The template is doing real work; don't dilute it.
- **Cross-repo work gets a repo table up top.** Every plan touching more than one repo opens with
  a table of repos, working dirs, and what each owns.
- **Cite `file:line` everywhere.** "Edit `engine.ts:346`" beats "edit the engine." This is the
  single highest-leverage habit for a plan being executable cold a week later by a different
  agent or a future reader.
- **Lock decisions explicitly.** A "Decisions (locked in)" block prevents drift
  mid-implementation. Pair it with "Out of scope" so the negative space is also explicit.
- **Decompose aggressively.** Several small plans beat one mega-plan. If two phases are genuinely
  independent, they belong in two files.
- **Use `followups/` for post-completion work.** When a plan ships but leaves perf/risk/
  verification work behind, lift those into a sibling plan rather than bloating the parent.
- **Reconcile to reality when the world has moved.** Picking up a partly-shipped plan, open with
  a "What's already shipped" section and adapt the remainder.
- **Capture diagnostic dead-ends on hard bugs.** A "What was ruled out before this" section walks
  readers (including future-you) through the wrong theories.
- **Document aborts.** A shelved plan moves to `aborted/` with: status line + date, named
  branches in each affected repo (or "no branches exist"), a "Why aborted" section, and a pointer
  to the replacement plan.
- **Link issues/PRs in the frontmatter** (`pr:` field) once filed. Cheap, durable, traceable.

## Pitfalls to avoid

- **Don't drift on status tracking.** Use the frontmatter `status:` field. The folder follows the
  status, not the other way around.
- **Don't strand plans at `Plans/` root.** Active work goes in `development/`. A plan that fits
  no bucket needs splitting, not a new bucket.
- **Don't grow a plan into a 35k-char design doc when it's really one PR.** Add a TL;DR to any
  plan crossing ~15k chars; move rationale to a `Concepts/` doc and keep the plan focused on
  execution.
- **Don't write parallel plans for what should be one consolidated plan.** When a new plan looks
  like a near-duplicate of an existing one, merge upstream.
- **Don't skip `## Completion notes` on a non-trivial plan.** The single most common gap and the
  highest-leverage one to fix.
- **Don't delete abortive starts — archive them.** A one-paragraph "tried this, won't work,
  here's why and where the branches are" file in `aborted/` beats a clean directory.
- **Don't let naming drift.** `SCREAMING_SNAKE_CASE.md` for plans. No kebab-case, no bare
  sequence numbers.
- **Don't write a plan retroactively to look like upfront design.** If work happened first and
  the plan was reverse-engineered, open with:
  `> Documented retroactively from the <date> session.`

## Plan tiers, informally

- **Spike plan** (< 5k chars): one page, no phases, single repo. Skip the repo table and
  risks/rollback. Keep the template light.
- **Standard plan** (5–15k chars): the default. Full template, 2–4 phases.
- **Coordination plan** (15k+ chars): always include a TL;DR. Multi-repo. Often spawns a
  `followups/` sibling. Treat as the design contract for a cross-cutting effort.

**Sizing red flag:** a plan heading past ~1000 lines should either (a) split into 2+ plans along
a natural seam, or (b) move rationale to a `Concepts/` doc and keep the plan on execution.

## When picking up a plan a week later

1. Read frontmatter `status:` first.
2. If multi-repo, check the repo table — confirm working dirs still match.
3. Look for `## Completion notes` at the bottom; if present, the plan is done — find a successor
   or open a new one.
4. If `predecessors:` are listed, scan their completion notes for context.
5. Re-verify any `file:line` citations before acting on them — they may have shifted; the memory
   of "this exists" is stronger than "it's still on line 346."

## Current work

The September 2026 round shipped in full, TREE_BRIEFING included, and `development/` is empty.
New work starts with a new plan in `development/`, not by reopening a completed one.

Vision and ordering for the round that just landed:
[Concepts/OKR Viewer - Product Vision.md](Concepts/OKR%20Viewer%20-%20Product%20Vision.md).
Teams-as-agents rationale: [Concepts/Teams as Agents - Design.md](Concepts/Teams%20as%20Agents%20-%20Design.md).

Shipped, in the order they landed — read the completion notes before assuming how something
works:
[OKR_SCHEMA_PACKAGE](Plans/completed/OKR_SCHEMA_PACKAGE.md) ·
[BUNDLED_DATASETS](Plans/completed/BUNDLED_DATASETS.md) ·
[CAMERA_LEVEL_AUTO_MOVES](Plans/completed/CAMERA_LEVEL_AUTO_MOVES.md) ·
[CLEAR_HIGHLIGHT_ON_SELECT](Plans/completed/CLEAR_HIGHLIGHT_ON_SELECT.md) ·
[OKR_NODE_EDITOR](Plans/completed/OKR_NODE_EDITOR.md) ·
[TEAM_MODEL_AND_EDITOR](Plans/completed/TEAM_MODEL_AND_EDITOR.md) ·
[CHAT_CONTEXT](Plans/completed/CHAT_CONTEXT.md) ·
[CHAT_TABS_AND_INTERVIEWS](Plans/completed/CHAT_TABS_AND_INTERVIEWS.md) ·
[NODE_HOVER_CARD](Plans/completed/NODE_HOVER_CARD.md) ·
[GRAPH_KEYBOARD_SHORTCUTS](Plans/completed/GRAPH_KEYBOARD_SHORTCUTS.md) ·
[FRAME_NODE_NEIGHBORHOOD](Plans/completed/FRAME_NODE_NEIGHBORHOOD.md) ·
[TREE_BRIEFING](Plans/completed/TREE_BRIEFING.md) ·
[DOCKER_IMAGES_AND_CI](Plans/completed/DOCKER_IMAGES_AND_CI.md).

TREE_BRIEFING also landed mode 1 of the four discussion modes (`persona`), so the next plan in
that area starts from modes 2–4, not from scratch. Read its completion notes before touching the
`respond` tool: `findings` is handed to an audit and to nothing else, and naming a field a mode's
tool schema does not have makes the model emit an empty tool call.

## What comes next (no plans yet)

The forward-looking half of this workspace. Each of these has a concept doc and no plan; writing
the plan is the first step.

- **Team agent discussions** — agents reviewing each other's OKRs, a debate the user moderates,
  and a closing turn that proposes edits. The four modes are chosen and written up in the "four
  discussion modes" section of
  [Concepts/Teams as Agents - Design.md](Concepts/Teams%20as%20Agents%20-%20Design.md); chat tabs
  left `mode` an enum so they are additive, and TREE_BRIEFING has since shipped mode 1 as the
  `persona` mode, launched from a briefing card. Modes 2–4 are what is left, and nearest to
  hand.
- **Agents that execute and measure OKRs**, and a progress dashboard reading what they record —
  [Concepts/Agents as Executors - Design.md](Concepts/Agents%20as%20Executors%20-%20Design.md)
  (Horizon 2 of the vision doc).
- **A shared, realtime document** so a team edits and chats against one `OkrDocument` at once
  (Horizon 3). Nothing persists today, tabs included.
- **Deeper hierarchies** (sub-objectives, individual KRs, org-shaped trees) once a focus budget
  and live alignment audit exist. Why the three-level ladder is a default, not doctrine, and why
  human focus is the constraint that replaces it:
  [Concepts/Depth and Focus - Design.md](Concepts/Depth%20and%20Focus%20-%20Design.md).
- **Matrix views** — OKR-against-OKR fitness, team-against-team reliance, and team-against-team
  communication tables, as the place off-tree relations live without turning the 3D scene into a
  hairball. Reliance is what teams say and comms is what they do; the gap between the two
  overlaid is the payoff, so the grid takes two layers from the first plan. Four plans when they
  get written, in dependency order: `TEAM_RELIANCE_MATRIX.md` (its source data already exists),
  `OKR_FITNESS_MATRIX.md`, `TEAM_MESSAGE_BOARD.md` (pair boards that modes 2–4 and Horizon 2
  executors want anyway), `TEAM_COMMS_CONNECTORS.md`.
  [Concepts/Matrix Views - Design.md](Concepts/Matrix%20Views%20-%20Design.md).
