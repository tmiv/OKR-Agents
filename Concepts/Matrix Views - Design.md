---
tags:
  - concept
  - product
  - okr
  - teams
created: 2026-09-12
---
# Matrix Views - Design

Three tables that show what the tree cannot: OKR-against-OKR fitness, team-against-team
reliance, and team-against-team communication. No plan exists yet; the plans this would spawn
are named at the bottom. Parent:
[OKR Agents - Product Vision](OKR%20Agents%20-%20Product%20Vision.md). Related:
[Teams as Agents - Design](Teams%20as%20Agents%20-%20Design.md),
[Agents as Executors - Design](Agents%20as%20Executors%20-%20Design.md) and
[Depth and Focus - Design](Depth%20and%20Focus%20-%20Design.md).

## The idea, as stated

A table whose rows and columns are both the OKRs; each cell scores how well the row OKR fits the
column OKR. A second table of the same shape whose rows and columns are both teams; each cell
scores how much one team relies on the other. A third of the same shape again, counting how
often those two teams actually talk.

The third one is not a third feature. Reliance is what teams *say*; communication is what teams
*do*. Laid over each other on identical axes, the gap between them is the product.

## Why a matrix, when there is already a 3D tree

The scene draws exactly one edge per node: the parent link. That is deliberate — the tree is
legible in 3D *because* it is a tree. Every real relation that is not a parent edge has nowhere
to live today: a KR that also serves a second objective, two teams both claiming "activation
rate", two objectives that pull the same team in opposite directions, an objective that quietly
waits on another team's delivery. Drawing those in the scene produces the hairball the 3D view
exists to avoid.

A matrix is the dense representation of precisely those off-tree edges. Two properties earn it:

- **Every pair gets a slot**, whether or not anything is in it. The tree can only show relations
  someone already recorded; the matrix shows the ones nobody has considered.
- **Emptiness is readable.** An empty row is an OKR nothing supports. A hot column is a team
  everyone is waiting on. Neither is visible in a tree at any zoom level.

The scene answers *where does this sit?* The matrix answers *what does this touch?*

## Matrix 1 — OKR fitness

`contributes` (`schema/src/okr-node.schema.json:51`) is already a fitness score: 0-1, hand
assessed, "how well this node supports its parent". One number per node, because there is one
parent. The matrix is that same idea generalised from *node → its parent* to *row → any column*.
The tree's own edges are then a thin diagonal band inside the matrix; the interesting cells are
all the others.

**The scale must be signed.** `contributes` runs 0-1 because a node cannot support its parent
negatively. Between arbitrary pairs it can: two objectives can compete for the same team, or one
can be achievable only by hurting the other. A -1..1 cell says "these two are in tension", and
that is the single most valuable cell in the table. A 0-1 scale cannot express it, so the matrix
does not reuse `contributes`' range even though it descends from it.

Cell vocabulary, then, is roughly: *supports* (positive), *unrelated* (zero, and the common
case), *redundant with* (positive but flagged — two nodes doing the same work), *in tension with*
(negative).

## Matrix 2 — Team reliance

`charter.dependsOn` (`schema/src/company.schema.json:96`, with `owns` at `:85`) is today a list
of unit ids: directed, unweighted, boolean, and hand-written. On the largest bundled dataset that
is 63 edges over 61 units, only 23 of which have a charter at all. The matrix keeps the
direction and adds two things: a weight, and a *derivation*.

Reliance can be derived rather than only asserted. Team A relies on Team B when A's KR names a
metric that appears in B's `charter.owns`, when A's objective hangs under an objective B owns, or
when A's charter says so outright. `dependsOn` then becomes the hand-asserted layer sitting on
top of a derived one, and **the disagreement between the two layers is the finding**: "Sales
lists no dependency on Platform, but four of their key results move a metric Platform owns."
That is a better artefact than either layer alone.

**Direction is stated once and shown in the UI: the row relies on the column.** With that fixed,
the table reads at a glance — a dense row is a team that cannot move alone, a dense column is a
bottleneck everyone waits on, and a symmetric pair is mutual reliance that probably wants a
shared objective.

## Matrix 3 — Team communication

Same axes as the reliance matrix, same grid, a different cell: how often these two teams
actually talk, over a window. Its value is almost entirely in the overlay.

| Reliance | Communication | What it means |
|---|---|---|
| High | Low | A dependency running on hope. The silent handoff that fails at the end of the quarter. |
| Low | High | An unmodelled dependency, or a coordination tax nobody budgeted for. |
| High | High | Working as designed. Nothing to say. |
| Low | Low | Correctly independent. Most of the table. |

Two off-diagonal quadrants and nothing else. That is the whole read, and neither matrix alone
produces it — which is why the grid component should take **two layers from the first plan**,
even if the second layer is empty until the comms data exists.

### When teams are agents: the message board is ground truth

If team agents talk to each other, they talk through something we build, so the communication
matrix is not estimated from telemetry — it is *counted*, and every cell is **inspectable**.
Click a cell and read the actual thread. No heat map that a person cannot drill into is worth
much; this one bottoms out in messages.

The shape that falls out: a **board per team pair**, addressable by the two unit ids,
append-only, every message attributed to a speaking team. That is a small object and it pays for
itself three times over:

- It is the async counterpart to mode 3 of the discussion modes. A debate is synchronous and
  user-moderated; a board is asynchronous and agent-driven. Both are transcripts; only the board
  has an address and a lifetime.
- Mode 2 ("agents review each other's OKRs") writes its review *to the board for that pair*
  rather than into a chat tab that evaporates, which is what makes the review re-readable later.
- Horizon 2 executors need exactly this seam to coordinate: Platform's executor telling Sales'
  executor that the metric moved is a board post, not a new mechanism.

Caveat worth stating up front: agent chatter is **cheap**, and a matrix that counts it will
reward agents for talking. Volume is not coordination. The cell should count threads or
exchanges, not messages, and the board should carry a per-pair budget the way a focus budget
caps key results.

### When teams are humans: connectors, and counts only

For human teams, the signal already exists in systems the org runs: cross-team review requests
and mentions on GitHub issues and PRs, shared Slack channels, ticket handoffs, meeting invites.
Three rules make this buildable and safe:

1. **Count, never content.** A connector returns `{ from, to, period, kind, count }` and the
   document stores those counts. The cell's value is frequency and direction; the content buys
   nothing for this view and is a liability in an exported file. This matches the executors
   doc's posture that credentials live outside the document — comms content stays outside it too.
2. **People are the join key, and the weak link.** Mapping a GitHub comment to a *team pair*
   means mapping author → person → unit, which `company.people` already supports (each person
   attached to exactly one unit). Unmapped people mean silently undercounted cells, so the view
   must show its own coverage: "62% of comms events mapped to a team."
3. **Group channels are hyperedges, not pairs.** A Slack channel with nine teams in it is not a
   relation between two of them. Either project it onto pairs with a stated rule (direct
   mentions and replies only) or exclude it. Do not let an all-hands channel light up the whole
   matrix.

Connections reuse the executor design's `unit.connections` shape (`kind`, `label`, `ref`); a
comms scan is a read-only connection of a kind that already has to exist. This is not a second
auth path.

### Normalisation and window

Raw counts lie. A sixty-person team out-messages a three-person team on every axis, so the cell
is a share — of that row team's total outbound, or per capita — not a raw count. And frequency
is meaningless without a window: one quarter, matched to the OKR cadence, so the comms matrix
and the tree it is compared against describe the same period.

## Where a cell value comes from

Three provenances, in the order they should be tried:

1. **Structural.** Free and deterministic: shared parent, same owning unit, a metric string that
   appears in another team's `owns`, an existing `dependsOn`. This fills most of the table and
   costs nothing.
2. **Model.** The plausible remainder, scored in an audit-shaped call. `mode: "audit"` already
   exists but returns `findings`; a matrix wants a list of scored pairs, which is a different
   return shape and therefore a *new mode with its own tool schema*. TREE_BRIEFING's lesson
   applies directly: naming a field the mode's tool schema does not have makes the model emit an
   empty tool call. Do not try to smuggle cells out through `findings`.
3. **Human.** Overrides and assertions, exactly like `contributes` today. Edits go through
   Actions and `commit` like everything else (vision invariant 3), which means a new action op
   rather than a side door.

The communication matrix sits outside that ladder: its cells are **observed**, not scored. They
are counted from boards or returned by a connector, and nobody hand-edits them — an observation
you can overwrite is not an observation. That difference is why the comms layer is stored
separately from the scored layers rather than as another `score` on the same cell.

## Storage: sparse, never N×N

The full matrix is never stored. 21 objectives is 441 cells; 113 key results is 12,769. A list
of `{ from, to, score, why }` for the cells someone asserted or the model scored above a
threshold is a document field; a 12,769-entry array is not. This is a second edge set living
beside the tree in the `OkrDocument` (vision invariant 4), added additively the way `company`
and `context` were.

Observed comms are a third, differently-shaped set: `{ from, to, period, kind, count }`, one row
per pair per window per source, and they accumulate over time rather than being overwritten.
Boards themselves are not document data at all — they are a store the agents write to, and the
document holds only the counts, the way `history.metricSamples` holds samples rather than the
tool output that produced them.

## Scoping: a matrix must be small before it is drawn

The axes are never "all nodes". Grounded in the bundled datasets: 21 objectives × 21 is a
readable heatmap, 113 KRs × 113 is wallpaper, and 61 units × 61 is somewhere in between.
Usable axis pairs:

- **objectives × objectives** — the default OKR view.
- **one team's KRs × another team's objectives** — the pair review, which is exactly mode 2 of
  the four discussion modes, laid out as a grid.
- **teams × teams**, scoped to one level of the org or to units that have charters.

Rule for any plan: a matrix view always names its two axes plus a filter, and refuses to render
above roughly 40 entries per axis rather than drawing something unreadable.

## How it ties into what exists

- **Clicking a cell** highlights both endpoints and frames them, reusing the highlight channel
  and the neighbourhood framing that already shipped. Selection still wins over highlight
  (invariant 5).
- **Findings are the same card.** An empty row, a hot column, a negative cell — each is a
  `Finding` with `nodeIds`, so the briefing surface renders matrix output with no new UI.
- **It is the index for team-agent reviews.** Mode 2 ("agents review each other's OKRs") costs
  one model call per pair; 61 teams is 3,721 pairs. The matrix is how you spend twelve calls on
  the pairs that matter instead.
- **A dense column is the focus-budget conversation** from Depth and Focus, arriving with
  evidence attached.
- **A pair board is where a review goes to live.** Mode 2's output currently has nowhere durable
  to land; the board gives it an address, and the comms matrix is the index of those addresses.

## Alternatives considered

- **Draw cross-links as extra edges in the 3D scene.** Rejected as the primary view: it is the
  hairball the tree layout exists to prevent. Plausible later for the handful of cells a user
  pins.
- **One triangle, symmetric cells.** Rejected. Support and reliance are directed, and the gap
  between "A relies on B" and "B relies on A" is the whole point of the table.
- **Score every cell with a model call.** Rejected on cost and noise. Structural first, model
  only for the plausible remainder.
- **Reuse `contributes` and its 0-1 range.** Rejected: it cannot express tension, which is the
  cell worth building the view for.
- **Store comms messages in the document and count them on the fly.** Rejected twice over:
  unbounded growth in a file meant to be exported, and content in an artefact that should hold
  only counts.
- **Analyse comms content — sentiment, topic, who is blocking whom.** Rejected. It is the fastest
  way to make people stop trusting the tool, and the frequency signal already answers the
  question the matrix is asking.
- **Infer communication from `history.changes` instead** (who edited whose nodes). Kept as a free
  fourth signal, rejected as *the* signal: it measures editing, not talking, and in a tool one
  person drives it measures almost nothing.

## When the plans get written

Four plans, not one. They share a grid component and little else, and they are in dependency
order, not value order.

1. `TEAM_RELIANCE_MATRIX.md` first. Its source data already exists (`dependsOn`, `owns`,
   `unitId`), the derivation is structural, and it needs no new scoring concept. **Its grid takes
   two layers from day one**, even though only one is populated — retrofitting an overlay onto a
   single-value heat map is the kind of rework this doc exists to prevent.
2. `OKR_FITNESS_MATRIX.md` second, once the grid component and the sparse relation storage have
   been proven by the first.
3. `TEAM_MESSAGE_BOARD.md` third, and note that it is worth building for its own sake — durable
   pair transcripts that modes 2 to 4 and Horizon 2 executors all want — with the comms matrix as
   the view over it rather than the reason for it. It needs somewhere to persist, so it is gated
   on Horizon 3 or on whatever store the executors get first.
4. `TEAM_COMMS_CONNECTORS.md` last, and only against a real org's data. Everything before it can
   be demonstrated on a bundled dataset; this one cannot, which is why it goes at the end
   regardless of how interesting it is.
