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

- Active: [Plans/development/AGENT_BONSAI_SYSTEM.md](Plans/development/AGENT_BONSAI_SYSTEM.md) —
  build the Agent Bonsai system (work tree for humans + agents, grown not carved).
  Design rationale: [Concepts/Agent Bonsai - Design.md](Concepts/Agent%20Bonsai%20-%20Design.md).
- Active: [Plans/development/BONSAI_GENOME.md](Plans/development/BONSAI_GENOME.md) — the genome
  layer: principles as DNA, entrenched and cascading. Additive; depends on the system plan's
  Phases 1–3.
- Active: [Plans/development/BONSAI_PITCH_DECK.md](Plans/development/BONSAI_PITCH_DECK.md) —
  marketing outline for the Bonsai pitch deck, written to be fed to multiple agents and image
  generators.
