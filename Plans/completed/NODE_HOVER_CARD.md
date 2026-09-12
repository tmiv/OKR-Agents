---
tags:
  - plan
  - web
  - graph
  - components
status: completed
created: 2026-09-11
completed_on: 2026-09-11
predecessors:
  - completed/OKR_NODE_EDITOR.md
  - completed/TEAM_MODEL_AND_EDITOR.md
---
# Plan: Extract the node summary into a NodeCard component and show it on 3D hover

Concept: [OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md)
(one state, several surfaces; the panel and the scene should describe a node the same way).

## Context

The node summary the user sees in the Detail panel (label, owner, metric, target) is markup
inside `web/src/Detail.svelte`: the `<h2>` at `:247` and the first three `<dl>` rows at
`:250-316`, interleaved with the edit-mode inputs. Hovering a node in the 3D view shows
something different: an HTML string built in `web/src/Graph.svelte:189-192` through
3d-force-graph's `nodeLabel`, styled by `.scene-tooltip .tip` in `web/src/app.css:94-95`. It
shows only label, owner and target, drops the metric, and cannot share styling, escaping or
team-name resolution with the panel because it is a string, not a component.

Graph already holds `company` (`Graph.svelte:13`) and resolves team names with `unitName`
(`web/src/lib/company.js`). 3d-force-graph exposes `onNodeHover` and `graph2ScreenCoords`
(`web/node_modules/3d-force-graph/dist/3d-force-graph.mjs`), which is enough to anchor a DOM
element to a node without the library's tooltip.

## Goal

One `NodeCard.svelte` renders label, owner, metric and target; Detail uses it for its read
view, and Graph shows it anchored to the hovered node in place of the library tooltip.

## Decisions (locked in)

1. **One component, two hosts.** `NodeCard` is presentational: it takes a node and a company
   and renders the four fields. Detail composes it above the rows it keeps (Supports, Fit,
   children); Graph renders it inside a hover anchor. No logic is duplicated.
2. **Owner is a link only when the host provides a handler.** Detail passes `onOpenTeam` and
   `onPreview`, so the owner stays a clickable, previewing link there. The hover card passes
   neither, so the owner is plain text; a hover card is not a click target.
3. **The library tooltip is switched off**, not layered under. `nodeLabel` returns `null`, and
   the `.scene-tooltip .tip` CSS goes.
4. **Anchored to the node, not the pointer.** The card's screen position comes from
   `graph.graph2ScreenCoords(node.x, node.y, node.z)` and is updated imperatively in Graph's
   existing `animate()` loop, so the card rides with the node during tumbling and fly-tos
   without pushing 60 state updates a second through Svelte. Only *which* node is hovered is
   Svelte state.
5. **Short show delay, instant hide.** 150 ms before showing, so sweeping the pointer across
   the tree while tumbling does not flash cards. Hidden immediately on leave, and never shown
   for the node whose Detail panel is already open (it would repeat what is on screen).
6. **Edit mode is untouched.** When Detail is editing, it renders its inputs as today; NodeCard
   is the read view only.

## Phase 1 — `NodeCard.svelte`

1. Create `web/src/NodeCard.svelte`. Props:
   `{ node, company = null, tree = null, onOpenTeam = null, onPreview = null }`.
   Derived: `ownerTeam = unitName(company, node.unitId)`; `teamNodes` as in
   `Detail.svelte:33-35` when `tree` and `onPreview` are given.
2. Markup: `<h2 class="card-label">{node.label}</h2>` then a `<dl class="card-fields">` with
   Owner, Metric, Target rows, moved verbatim from the read branches at `Detail.svelte:277-281`,
   `:297` and `:314` (including `class:empty` and the "none — not measurable" / "none" copy).
   Owner renders the link button with the `hover(teamNodes)` spread only when `onOpenTeam` is
   set; otherwise `{ownerTeam ?? node.owner ?? '—'}`.
3. `web/src/app.css`: move the rules for `.detail h2` (`:113`) and `.detail dl/dt/dd` and
   `dd.empty` (`:115-118`) to `.card-label` and `.card-fields` selectors so both hosts share
   them; keep the `.detail` versions for the rows Detail still owns (Supports, Fit).

## Phase 2 — Detail uses it

1. `Detail.svelte:247` (read branch of the label) and the read branches of the three rows at
   `:277-281`, `:297`, `:314`: replace with
   `<NodeCard {node} {company} {tree} onOpenTeam={onOpenTeam} onPreview={onPreview} />` placed
   before the `<dl>`, and drop those read branches from the `{#if editing}` blocks so the
   editing `<dl>` only renders inputs. The Supports and Fit rows (`:318-357`) stay in Detail's
   own `<dl>`.
2. Remove `ownerTeam` and `teamNodes` from Detail if nothing else uses them (`:26`, `:33-35`);
   the `hover()` helper at `:38-43` stays for the parent and child links.

## Phase 3 — Graph shows it on hover

1. `Graph.svelte`: add `let hovered = $state(null)` (a node object from `graph.graphData()`),
   `let hoverTimer`, `let anchorEl` (bound `div`). Add `onNodeHover` after `.onNodeClick`:
   - on a node: clear the timer; `hoverTimer = setTimeout(() => (hovered = n), 150)`.
   - on `null`: clear the timer; `hovered = null`.
   - `el.style.cursor` is already managed by the library; leave it.
2. `.nodeLabel(() => null)` replaces `:189-192`; delete the `esc` helper if it is no longer
   used.
3. In `animate()`: if `hovered && anchorEl && Number.isFinite(hovered.x)`, compute
   `const { x, y } = graph.graph2ScreenCoords(hovered.x, hovered.y, hovered.z)` and set
   `anchorEl.style.transform = \`translate(${x + 14}px, ${y - 10}px)\``. Clamp so the card stays
   inside `el` (`el.clientWidth - anchorEl.offsetWidth - 8`, same for height); flip to the
   left of the node when it would overflow right.
4. Markup under the graph div:
   ```svelte
   {#if hovered && hovered.id !== selectedId}
     <div class="hover-card" bind:this={anchorEl}>
       <NodeCard node={hovered} {company} />
     </div>
   {/if}
   ```
   `hovered` is a graph node object (it carries `x/y/z` plus the OkrNode fields, see
   `toGraphData`), which NodeCard reads like any node.
5. Hide on data changes: in the `tree` effect, if `hovered` is no longer in the tree, set it
   to `null`. Also set `hovered = null` inside `flyTo` so a card does not linger on a node the
   camera is leaving.
6. `app.css`: `.hover-card { position: absolute; top: 0; left: 0; pointer-events: none; width: 300px; background: rgba(18,24,38,0.95); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; backdrop-filter: blur(6px); will-change: transform; }`
   and remove the `.scene-tooltip .tip` rules (`:94-95`). `.graph` is `position: absolute; inset: 0`
   (`app.css:65`) and the card is its sibling inside `.stage`, so coordinates from
   `graph2ScreenCoords` (relative to the renderer's element) map directly.

## Verification

- Hover a KR: after a short pause a card with label, team name, metric and target appears
  beside the sphere; it follows the node while tumbling; it disappears the instant the pointer
  leaves the sphere. No library tooltip appears alongside it.
- Hover `kr-7` (no metric): the metric row reads "none — not measurable" in red, identical to
  the Detail panel.
- Hover a node near the right edge of the stage: the card flips to the left and stays inside
  the stage.
- Click a node so Detail opens, then hover the same node: no card. Hover a different node: card.
- Detail read mode renders the same four fields as before; the owner link still opens the team
  editor and still previews the team's nodes on hover; edit mode is unchanged.
- Rename a team in TeamEditor while a card is visible for one of its nodes: the card updates
  (it reads `company` reactively).
- Switch datasets while hovering: the card disappears, no console errors.

## Out of scope

- Hover cards for links or for team labels.
- Making the hover card interactive (buttons, links).
- Touch devices (no hover).
- Any change to edit-mode inputs.

## Risks / rollback

- `graph2ScreenCoords` returns coordinates relative to the renderer's canvas; if the graph
  container ever gets padding, the offset will show. It has none today.
- `onNodeHover` fires with `null` on every frame the pointer is over empty space; the handler
  must be cheap (it is: clear a timer, set state only when it changes).
- Rollback: restore `nodeLabel` and the tooltip CSS; Detail's read markup is a mechanical
  inline of NodeCard.

## Completion notes

- **Planned vs. actual.** The three phases landed as written. `NodeCard.svelte` took the four
  fields verbatim from Detail's read branches; Detail now renders the card above a `<dl>` that
  holds only Supports and Fit in read mode and only the inputs in edit mode; Graph switched
  `nodeLabel` off, added `onNodeHover` behind a 150 ms timer, and positions the card from
  `graph2ScreenCoords` in `animate()`. The clamp and the left-flip work: over a 420 px-wide
  stage the card for a node at x=163 came out at `translate(8px, …)`, i.e. flipped and pinned
  inside the stage.
- **Mid-flight adjustments.** Three, all small. (1) `hovered` is `$state.raw`, matching the
  idiom App.svelte already uses — the force layout mutates these node objects every tick and we
  only ever swap which one is held. (2) `anchorEl` needed `$state(null)` for `bind:this`, or
  Svelte warns. (3) Splitting one `<dl>` into two left the Supports row butting against Target,
  so `.detail .card-fields` carries a 6 px bottom margin to keep the row gap across the seam.
  Also, the tree effect re-points `hovered` at the fresh node object rather than only nulling
  it when the node is gone, so an edit under the pointer refreshes the card.
- **Surprises / residual risks.** Two verification items in this plan cannot actually be
  performed by hand: renaming a team or switching datasets "while a card is visible" requires
  moving the pointer off the node, which hides the card. The code paths behind them are
  covered — the card reads `company` through NodeCard's `$derived`, and the tree effect drops a
  hovered node that no longer exists — but neither was exercised end to end. Separately, on a
  narrow stage the card can be clamped underneath the Detail panel (the panel paints over it,
  since it comes later in `.stage`); at the real stage width there is room and it does not
  happen. Touch devices remain out of scope.
