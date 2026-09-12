---
tags:
  - plan
  - web
  - graph
  - camera
status: completed
created: 2026-09-12
completed_on: 2026-09-12
---
# Plan: Frame the selected node with its parent and children

Concept: [OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md)
(invariant 5: "the scene never disorients the user on its own").
Predecessor: [CAMERA_LEVEL_AUTO_MOVES](../completed/CAMERA_LEVEL_AUTO_MOVES.md) —
this plan reuses `levelCamera` untouched.

## Context

Selecting a node flies the camera to that node alone. Both gestures that select do it:

- `web/src/Graph.svelte:230` — `.onNodeClick((n) => { onSelect?.(n.id); flyTo([n.id], 800); })`
- `web/src/App.svelte:498` — `graph?.flyTo([next.id], 600)` inside `go(dir)`, the arrow-key step.

`flyTo` (`web/src/Graph.svelte:119-139`) takes a set of ids, averages their positions, measures a
radius about that centroid, and picks `dist = Math.max(140, radius * 2.2 + 120)`
(`Graph.svelte:132`). With one id the radius is 0, so the flight always ends at the floor of 140
world units from a single sphere. The node fills the view and its context — the objective it rolls
up to, the key results that roll into it — is off-screen or at the edge. The user then has to
tumble or press `f` (`App.svelte:505`) to re-establish where they are, which is exactly the
re-orienting work the scene is supposed to do for them.

The layout is `dagMode('td')` with `dagLevelDistance(90)` (`Graph.svelte:212-213`), so a node's
parent sits ~90 units above it and its children ~90 below plus lateral spread. A frame that holds
one level up and one level down is a bounded, predictable amount of scene.

`zoomToFit`/`fitToBbox` cannot do this job: it hard-codes the aim point to the world origin
(`web/node_modules/three-render-objects/dist/three-render-objects.mjs:385`,
`// reset camera aim to center`), so it only ever frames things about the centre of the scene.
A local frame has to be computed here. `frameAll` (`Graph.svelte:143`) keeps using it and is
unchanged.

## Goal

Selecting a node — by click or by arrow key — ends with that node centred and its parent and all
its direct children inside the frame.

## Decisions (locked in)

1. **Neighbourhood = the node, its parent, its direct children.** No siblings, no grandchildren.
   That is the ask, and it is the unit that makes a node's alignment readable: what it supports,
   and what supports it.
2. **Aim at the selected node, not at the neighbourhood centroid.** The neighbourhood is
   asymmetric (one parent up, n children down and spread), so a centroid aim would leave the
   selected sphere off-centre and would visibly drift as the user arrow-steps through a chain.
   Centring the selection costs distance — the fit radius is measured from the selected node
   rather than from the tightest centre — and buys a stable eye position.
3. **One framing function, a real perspective fit.** `flyTo` and the new focus share it, and it
   replaces the `radius * 2.2 + 120` guess with the distance at which a bounding sphere of radius
   `R` about the aim point fills the padded frame: `R / sin(min(halfVFov, halfHFov))`. The camera
   is a default-fov `PerspectiveCamera` (three-render-objects never sets `fov`, so 50°;
   `aspect` is maintained at `three-render-objects.mjs:632,653`). This also means the assistant's
   highlight frame (`Graph.svelte:296`) gets the corrected distance — accepted, it is more
   correct, and it is the same code path.
4. **The tree-walking lives in `navigate.js`.** It is the pure, browser-free module the keyboard
   shortcuts already use, and it is where `parentOf`/`firstChildOf` already are
   (`web/src/lib/navigate.js:14,19`). `Graph.svelte` imports it; the neighbourhood is then covered
   by `node --test` rather than only by eye.
5. **Keep the current-bearing approach**, clamped off the tree's axis. The flight still comes in
   along the bearing the user left the camera on (`Graph.svelte:134-137`), but a bearing within
   20° of world ±Y projects parent and children on top of each other and makes the frame
   meaningless. Phase 4 clamps it. This is a bounded override of the user's bearing on a move
   that already re-levels `camera.up`, so it is in keeping with invariant 5 rather than against it.
6. **Only the two gestures that move the camera today keep moving it.** Clicking a related node in
   the Detail panel still selects without flying (`App.svelte:449` `select()` moves no camera).
   Changing that is a separate question.

## Phase 1 — `neighborhoodOf` in `navigate.js`

1. `web/src/lib/navigate.js:19` — next to `firstChildOf`, add
   `export const childrenOf = (tree, id) => tree.nodes.filter((n) => n.parent === id);`
2. Below `siblingOf` (`navigate.js:25-36`), add:
   ```js
   // The frame a selection deserves: the node, what it rolls up to, and what rolls
   // into it. Ids, in no particular order — the camera only averages positions.
   // Returns [] for an id that is not in the tree, so a stale selection is a no-op.
   export function neighborhoodOf(tree, id) {
     const n = tree.nodes.find((x) => x.id === id);
     if (!n) return [];
     const p = parentOf(tree, id);
     return [id, ...(p ? [p.id] : []), ...childrenOf(tree, id).map((c) => c.id)];
   }
   ```
3. `web/src/lib/navigate.test.js` — the fixture at `:8-17` already has a root with two objectives
   and three KRs under `obj-a`. Add tests against it:
   - `neighborhoodOf(tree, 'obj-a')` → `root`, `obj-a`, `kr-1`, `kr-2`, `kr-3` (compare as sets;
     array order is not a contract here).
   - `neighborhoodOf(tree, 'kr-2')` → `kr-2`, `obj-a` — a leaf frames itself and its parent.
   - `neighborhoodOf(tree, 'root')` → `root`, `obj-a`, `obj-b` — the root has no parent to add.
   - `neighborhoodOf(tree, 'gone')` → `[]`.
   - `childrenOf(tree, 'obj-b')` → `[]`.

## Phase 2 — one framing function in `Graph.svelte`

1. Add near `LEVEL` (`Graph.svelte:40-44`):
   ```js
   const FRAME_MARGIN = 1.15; // breathing room around the bounding sphere
   const MIN_DIST = 140;      // a lone node must not fill the screen
   ```
2. Add a `nodeRadius` helper — `LEVEL[n.level]?.size ?? LEVEL.kr.size` — so the fit accounts for
   the spheres themselves, not just their centres (the company sphere is 10 units across the
   radius; ignoring it crops the root).
3. Replace the body of `flyTo` (`Graph.svelte:119-139`) with a call into a new internal
   `frame(nodes, aim, ms)`, keeping `flyTo(ids, ms = 1200)` exported with its current signature
   and its centroid aim:
   ```js
   // Distance at which a sphere of radius r about the aim point fills the frame.
   function fitDistance(r) {
     const cam = graph.camera();
     const halfV = (cam.fov * Math.PI) / 360;
     const halfH = Math.atan(Math.tan(halfV) * cam.aspect);
     return r / Math.sin(Math.min(halfV, halfH));
   }

   function frame(nodes, aim, ms) {
     levelCamera(ms);
     let r = 0;
     for (const n of nodes) {
       r = Math.max(r, Math.hypot(n.x - aim.x, n.y - aim.y, n.z - aim.z) + nodeRadius(n));
     }
     const dist = Math.max(MIN_DIST, fitDistance(r * FRAME_MARGIN));
     const cam = graph.cameraPosition();
     const dir = new THREE.Vector3(cam.x - aim.x, cam.y - aim.y, cam.z - aim.z);
     if (dir.length() < 1) dir.set(0, 0.3, 1);
     dir.normalize();
     graph.cameraPosition(
       { x: aim.x + dir.x * dist, y: aim.y + dir.y * dist, z: aim.z + dir.z * dist }, aim, ms
     );
   }
   ```
   `flyTo` keeps its own guards ahead of the call: the `graph`/`ids` check, `clearTimeout`,
   `hovered = null`, the `Number.isFinite(n.x)` filter (a node added this frame has no position
   yet), and the empty-after-filter bail.

## Phase 3 — `focusNode`, and its two callers

1. `Graph.svelte`, beside `flyTo` — import `neighborhoodOf` from `./lib/navigate.js` (the `tree`
   prop is already in scope, `Graph.svelte:10`) and add:
   ```js
   // Selecting a node frames its neighbourhood but keeps the node itself centred:
   // the selection is what the panel is about, so it is what the eye holds.
   export function focusNode(id, ms = 800) {
     if (!graph || !id) return;
     clearTimeout(hoverTimer);
     hovered = null;
     const want = new Set(neighborhoodOf(tree, id));
     const nodes = graph.graphData().nodes.filter((n) => want.has(n.id) && Number.isFinite(n.x));
     const self = nodes.find((n) => n.id === id);
     if (!self) return; // no position yet: leave the camera where it is
     frame(nodes, { x: self.x, y: self.y, z: self.z }, ms);
   }
   ```
2. `Graph.svelte:230` — `.onNodeClick((n) => { onSelect?.(n.id); focusNode(n.id, 800); })`
3. `App.svelte:498` — `graph?.focusNode(next.id, 600)`. The comment above `go` at
   `App.svelte:492-493` says an arrow step "is exactly a sphere click"; it still is, so it needs
   no rewrite, but the line about flight length stays accurate — keep 600 ms.
4. Leave `Graph.svelte:296` (`if (highlight.length) flyTo(highlight)`) on `flyTo`: an assistant
   highlight is an arbitrary set with no single subject to centre.

## Phase 4 — keep the bearing off the tree's axis

In `frame`, after `dir.normalize()`:

```js
// dagMode('td') puts parent and children directly above and below. Looking down
// the tree's axis collapses that separation, so come in at least 20° off it.
const MAX_Y = Math.cos((20 * Math.PI) / 180);
if (Math.abs(dir.y) > MAX_Y) {
  const h = new THREE.Vector3(dir.x, 0, dir.z);
  if (h.lengthSq() < 1e-6) h.set(0, 0, 1);
  h.normalize().multiplyScalar(Math.sqrt(1 - MAX_Y ** 2));
  dir.set(h.x, Math.sign(dir.y) * MAX_Y, h.z);
}
```

Azimuth is preserved, so the move still reads as "from where I was". Independently shippable, and
droppable if it feels like the camera is fighting the user.

## Verification

- `docker exec dev sh -c 'cd /src/web && npm test'` — Phase 1's tests plus the eleven existing
  `navigate` tests. (Host Node is 12; the tests need the dev container.)
- `docker exec dev sh -c 'cd /src/web && npm run dev'`, then in the browser:
  - Click a key result: its objective is in frame above it, the KR is centred.
  - Click an objective on `polaris-group-fy26`: parent and every KR in frame, nothing clipped at
    the edges; check a wide objective (most children) and a narrow one.
  - Click the company root: the objectives ring it, and the frame is not the whole tree.
  - Arrow ↓ then ↑ through three levels: the selected sphere stays centred across the chain and no
    flight overshoots.
  - `f` still frames the whole tree, and the horizon is level after each move (invariant 5).
  - Ask the assistant something that highlights several nodes: the frame still holds them all, at
    the new (slightly further) distance.
  - Phase 4: tumble to look straight down the tree, then arrow-step — the camera tilts off the
    axis and parent/child separation is visible.

## Out of scope

- The Detail panel occludes the left 334 px of the stage (`web/src/app.css:112-114`); a frame
  centred on the canvas puts the selection partly under it. Offsetting the aim for the panel is a
  real follow-up, not this plan.
- Camera moves for selections made from the Detail panel's related-node lists or from a team
  panel (Decision 6).
- Siblings, grandchildren, or a configurable frame depth.
- Framing the team label sprites (`Graph.svelte:69-73`), which extend to the right of a sphere by
  an amount that depends on text length.
- `frameAll` and `zoomToFit`.

## Risks / rollback

- **It may read as "zoomed out".** A leaf KR goes from 140 units to roughly 2.7 × (90 + radius) ≈
  270. `FRAME_MARGIN` and `MIN_DIST` are the two knobs and sit together at the top of the file;
  rollback is `focusNode` → `flyTo` at the two call sites in Phase 3.
- **A node whose children were just added has no layout position yet**, so they are filtered out
  and the frame is tighter than intended for one move. Acceptable: the next selection is correct.
  Not worth waiting on the force simulation.
- **Phase 3 imports `navigate.js` into `Graph.svelte`**, which previously held no tree logic. The
  import is one pure function and keeps the walk testable; the alternative — deriving the
  neighbourhood from `graph.graphData().links` — would duplicate it against a different source.

## Completion notes

- **Planned vs. actual:** all four phases landed as written, `file:line` citations included. The
  three code moves — `neighborhoodOf` in `navigate.js`, `frame`/`fitDistance` shared by `flyTo`
  and `focusNode`, the 20° bearing clamp — went in unchanged from the plan's snippets. Five new
  tests in `navigate.test.js`; the suite is 16 green.
- **Mid-flight adjustments:** none to the design. One ordering change inside `flyTo`: it now
  computes the centroid and hands off to `frame`, which owns the `levelCamera(ms)` call, so the
  levelling happens once in one place rather than in each caller.
- **Surprises / residual risks:** the camera transition plus the force layout settling takes
  noticeably longer than the flight duration on the 135-node `polaris-group-fy26` tree — several
  seconds before the selection is truly centred. It is the pre-existing tween, not this change,
  but it makes the new framing look wrong mid-flight in a way the old fixed-distance move did
  not. The Phase 4 clamp is a *minimum* 20° off-axis, which from a near-top-down bearing still
  reads as near-top-down; if it proves too weak in use, `MAX_Y` is the single knob. The Detail
  panel occlusion called out in "Out of scope" is now the most visible remaining rough edge: a
  centred selection sits under the panel's right edge on narrow windows.
