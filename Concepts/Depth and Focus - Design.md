---
tags:
  - concept
  - product
  - okr
  - agents
created: 2026-09-11
---
# Depth and Focus - Design

A point of view on why multi-level OKR hierarchies, long considered an anti-pattern, become
viable when an AI carries the alignment work, and what that does to this product's job.
Parent: [OKR Agents - Product Vision](OKR%20Agents%20-%20Product%20Vision.md). Related:
[Agents as Executors - Design](Agents%20as%20Executors%20-%20Design.md).

## The received wisdom, and what it was protecting

Google and the early OKR practitioners warned against individual OKRs and deep cascades. The
warning was about **alignment fatigue** in a manual system: pushing goals down four or five
levels meant endless meetings, spreadsheet formatting, and hand audits to find the links that
had quietly broken. Three levels was not a law of strategy; it was the most a human
organisation could keep honest.

## What changes with AI in the loop

The bottleneck moves from **administrative capacity** to **strategic clarity**. Three things
that used to cost people-hours become cheap:

- **Vertical alignment on demand.** Given the top-level objectives, a model can draft
  context-aware sub-objectives and key results for a squad, a pod, or a person, and keep each
  one semantically and numerically tied to the rung above it.
- **Continuous dependency auditing.** Instead of the end-of-quarter review, the link check runs
  on every change: "Team B rewrote their key result, and Company Objective 2 is now unvouched
  for." In this product that is already the shape of things: `contributes` is the link
  strength, weak links are surfaced live, and every edit is an Action the assistant can react
  to.
- **Context preservation at scale.** A micro-metric owned by one engineer stays anchored to the
  five-year vision because the model can always re-derive the chain, not because someone
  remembers it.

## The new bottleneck: human focus

Removing the administrative ceiling exposes a psychological one. A model can draft and track
thousands of perfectly aligned OKRs; a person can still hold three to five priorities.

| Manual-era constraint | AI-era constraint |
|---|---|
| Administrative burden: spreadsheet cells and broken links. | Over-optimisation: too many perfect metrics that dilute focus. |
| Rigid hierarchy: three levels because humans cannot track more. | Analysis paralysis: an endless stream of automated signals. |
| Infrequent updates: quarterly, because that is all there was time for. | Noise versus signal: real progress versus AI-generated busywork. |

## What this means for the product

1. **Depth is a data-model decision, not a strategy decision.** The current ladder (company →
   objective → key result) is enforced in the editor and the prompt and only *warned about* by
   the schema (`schema/index.js:205`). That is the right posture: the format should tolerate
   depth today, and a future plan can open the editor and the prompt to sub-objectives, team
   trees that mirror the org chart, and individual key results, without a migration.
2. **The product's job shifts from *drawing* the tree to *keeping it honest and small*.** Two
   capabilities matter more than nesting:
   - **Live alignment audit.** Every Action should be able to trigger "what did this break?"
     The weak-link count in the topbar is the seed; the mature form is an assistant that
     highlights the newly orphaned or diluted chain the moment a node changes.
   - **A focus budget.** Per team (and later per person), the number of active key results is
     something the UI shows and the assistant pushes back on. "You now have nine KRs; which
     three matter this quarter?" is a better coaching move than generating a tenth.
3. **Generation is cheap, so the interface must make *choosing* cheap.** Interview tabs and
   "interview me about a new OKR" should produce candidates the user picks from, not a finished
   subtree they must prune. Drafts are proposals; commits are decisions.
4. **Signal over noise is a first-class concern for executors** (Horizon 2). An agent that can
   report progress hourly must not; sampling cadence and "what changed that matters" summaries
   are part of the executor design, not an afterthought.
5. **Depth in the 3D scene is free.** The DAG layout is level-agnostic. A five-level tree renders
   today; the scene's role becomes showing where focus is concentrated and where links are
   thin, which is exactly what edge weight and colour already encode.

## Principles to carry into plans

- **AI drafts, humans decide.** No plan may auto-apply generated OKRs. Everything goes through
  a visible commit the user can undo.
- **Every rung must vouch for the one above it.** `contributes` stays required in spirit for
  any node with a parent, at any depth.
- **Few active priorities per owner.** When counting features, prefer ones that reduce what a
  person must look at over ones that add what the system can produce.
- **Audit on change, not on schedule.** Broken links are found at the edit, not at the review.

## Alternatives considered

- **Keep three levels as a hard rule.** Rejected as a principle, kept as today's default. The
  rule protected against a cost the assistant now absorbs; enforcing it forever would encode a
  workaround as doctrine.
- **Open depth immediately.** Deferred. Without the focus budget and live audit, deeper trees
  reintroduce the very fatigue the rule prevented, just with the model doing the typing.

## When a plan should cite this doc

- Any plan that relaxes the level ladder (sub-objectives, individual KRs, org-shaped trees).
- Any plan that adds generation (bulk OKR drafting, cascade from a company objective).
- The executor and dashboard plans, for cadence and signal-versus-noise decisions.
