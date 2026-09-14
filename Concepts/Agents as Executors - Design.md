---
tags:
  - concept
  - teams
  - agents
  - progress
created: 2026-09-11
---
# Agents as Executors - Design

Horizon 2 of [OKR Agents - Product Vision](OKR%20Agents%20-%20Product%20Vision.md): a team's
agent does not only *talk* about the team's OKRs (see
[Teams as Agents - Design](Teams%20as%20Agents%20-%20Design.md)), it *works* on them through
connected tools and *measures* them, and a dashboard shows progress. No plan exists yet; this
doc fixes the vocabulary and the seams so Horizon 1 does not close them.

## The example that defines the feature

A team "Widget library maintenance" has the KR "Address 90% of incoming issues on the widget
GitHub repo, each ranked by priority." Its agent, running as that team with the team's charter,
should be able to:

1. connect to the repo through a tool connection the user has authorised;
2. read incoming issues, triage and rank them, reply or label them, on a schedule or on demand;
3. record how it is doing against the KR (issues addressed / issues received) as metric samples;
4. leave a trail the user can inspect, undo where the tool allows, and turn off.

The user should be able to do 3 by hand for any KR, agent or not, and a dashboard should read
the same samples.

## Vocabulary

- **Executor**: a long-running agent process bound to one team and one or more of its nodes,
  built from the team's charter, the node's label/metric/target, and a set of **connections**.
- **Connection**: a named, authorised handle to an external system (a GitHub repo, a tracker,
  an analytics source), owned by a team. Credentials never enter the document; the document
  holds a reference.
- **Run**: one execution of an executor: when, what it read, what it did, what it measured.
- **Metric sample**: `history.metricSamples[]` `{ nodeId, at, value, note }`, already in the
  schema. The one shape for progress, whether a person types it or an executor computes it.
- **Progress**: a derived view over samples against a node's `target` (baseline → goal by date).
- **Dashboard**: a surface that reads progress across the tree; not the 3D scene.

## Shape sketches (all additive to the v1 document)

```
unit.connections: [{ id, kind: 'github' | 'jira' | 'http' | ..., label, ref: { owner, repo } }]
unit.executors:   [{ id, nodeIds: [...], connectionIds: [...], cadence: 'manual' | 'hourly' | 'daily',
                     enabled: boolean, instructions: "free text the user adds to the charter" }]
history.runs:     [{ executorId, startedAt, endedAt, status, summary, actions: Action[],
                     samples: MetricSample[] }]
history.changes[].actor: 'user' | 'assistant' | 'import' | 'agent'
node.target:      stays free text; a parsed { baseline, goal, by } view is derived, not stored,
                  until a real need forces structure.
```

## Invariants

- **Everything an executor changes in the document is an Action with `actor: "agent"`**, through
  the same commit path. The user can undo it in the app exactly like an assistant edit.
- **External side effects are recorded, not undoable.** A run's `summary` and per-action log say
  what happened in GitHub; the app does not pretend to revert a comment.
- **Progress has one shape.** User-entered and agent-computed samples are the same thing with a
  different `note`. The dashboard never asks who wrote a sample to render it.
- **The charter is the persona; the executor adds instructions, never replaces it.** If a team's
  charter is wrong, its executor is wrong. That is the point: fix the team, not the bot.
- **Credentials live outside the document.** A connection reference is safe to export.

## Where executors run

The current service is stateless and request-scoped (`service/index.js`). An executor is a
process that outlives a request and may run on a schedule. Options, to be decided in the plan:

1. **A worker beside the service** (same repo, `service/executors/`), triggered by an endpoint
   and by cron, writing results back through a `/api/commit`-style endpoint. Simplest; needs
   Horizon 3's store or at least a file-backed document to write to, since the browser will
   not be open.
2. **The browser orchestrates** (as the debate design does). Works for on-demand runs while the
   tab is open; does not work for schedules. Good enough for a first demo of "run it now".
3. **Claude Agent SDK sessions** with the team charter as the system prompt and connections
   exposed as tools. This is what an executor most naturally is; the worker in option 1 would
   host these.

Option 2 first for the demo, option 1 + 3 once Horizon 3 gives the worker a document to write.

## Dependencies on earlier horizons

- Horizon 1 `TEAM_MODEL_AND_EDITOR`: charters, `unitId`, team Actions. Without those there is
  no "run as the team".
- Horizon 1 `OKR_NODE_EDITOR`: `commit()` with `actor`; the executor is one more actor.
- Horizon 3 (shared document): scheduled runs need a document that exists when no browser is
  open. On-demand runs do not.

## Alternatives considered

- **Storing progress on the node** (`node.current`). Rejected: loses history, and the schema
  already has samples. Progress is a time series.
- **Structured `target` now.** Deferred: a parser over "31% → 50% by Q4" covers the demo data,
  and forcing structure before the dashboard exists would be design by guess.
- **Executors as a separate document type.** Rejected: an executor is a property of a team and
  travels with it in export/import.

## Open questions for the eventual plan

- How does the user authorise a connection without the app holding secrets? (OAuth with tokens
  kept server-side, keyed by connection id, is the obvious shape.)
- What does "undo" mean for a run that commented on twelve issues?
- Does the dashboard live in this app (a fourth surface) or is it a separate page over the same
  document?
- Sampling cadence and who resolves conflicts when a user and an agent both record a sample for
  the same period.
