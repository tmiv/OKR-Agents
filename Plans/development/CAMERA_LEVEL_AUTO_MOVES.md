---
tags:
  - plan
  - web
  - graph
status: development
created: 2026-09-11
---
# Plan: Level the camera to world up during programmatic moves

Concept: [OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md)
(invariant 5: "the scene never disorients the user on its own"). Spike plan, one file.

## Context

`3d-force-graph` defaults to `TrackballControls`
(`web/node_modules/three-render-objects/dist/three-render-objects.mjs:486` and `:603-607`).
Trackball rotates `camera.up` freely (`web/node_modules/three/examples/jsm/controls/TrackballControls.js:510`),
so after the user tumbles, the camera carries a roll. Every programmatic move (`flyTo` at
`web/src/Graph.svelte:58-75`, `zoomToFit` at `:125`) goes through `cameraPosition()`
(`three-render-objects.mjs:306-340`), which tweens position and `controls.target` but never
touches `camera.up`. `TrackballControls.update()` then calls `object.lookAt(target)`
(`TrackballControls.js:381`) with the rolled up vector, so the whole flight is tilted, and the
roll about the view axis visibly changes as the lookAt target moves.

The layout is `dagMode('td')` (`Graph.svelte:104`): world +Y is the tree's top, so "level" has
a real meaning.

## Goal

Every programmatic camera move ends with screen-up equal to world +Y, the roll is removed
smoothly over the flight, and user tumbling stays free (trackball, may roll).

## Decisions (locked in)

1. **Keep trackball.** Users can still roll. Only programmatic moves re-level. (Interview,
   2026-09-11.)
2. **Re-level, don't just preserve.** The move tweens `camera.up` from its current value to
   world +Y over the same duration as the position tween with the same `Quadratic.Out` easing,
   so a rolled camera un-rolls during the flight rather than snapping.
3. **Implemented in `Graph.svelte`, no library patch.** `graph.camera()`
   (`web/node_modules/3d-force-graph/dist/3d-force-graph.mjs:276`) exposes the THREE camera and
   `graph.controls()` (`:285`) the trackball. `camera.up` is read by trackball's `lookAt` every
   frame, so driving it from our own `animate()` loop (`Graph.svelte:77-99`) is enough.
4. **Degenerate view guarded.** If the view direction is within ~11° of world ±Y (looking
   straight down the tree), `lookAt` with up = +Y is undefined. Level toward world −Z instead.
5. **Trackball inertia off.** `staticMoving` defaults to `false` (`TrackballControls.js:147`),
   so a flick before a fly-to keeps rotating `camera.up` while we tween it. Set
   `staticMoving = true`. This also removes inertia from user tumbling; that is the tradeoff
   that makes programmatic moves deterministic. The alternative (zeroing the private
   `_lastAngle`) is version-fragile.

## Phase 1 — `levelCamera(ms)` in Graph.svelte

1. Next to `Graph.svelte:12-14` add `const WORLD_UP = new THREE.Vector3(0, 1, 0);` and
   `let upTween = null;`.
2. Add `function levelCamera(ms)`:
   - `const cam = graph.camera(); const from = cam.up.clone().normalize();`
   - `const view = graph.controls().target.clone().sub(cam.position).normalize();`
   - `let to = WORLD_UP; if (Math.abs(view.dot(WORLD_UP)) > 0.98) to = new THREE.Vector3(0, 0, -1);`
     (Decision 4).
   - Return early if `from.distanceToSquared(to) < 1e-6`.
   - If `from.dot(to) < -0.999` (upside down), nudge `from` by `0.01` along
     `view.clone().cross(to)` so the interpolation has a direction.
   - `upTween = { from, to, start: performance.now(), ms };`
3. In `animate()` (`Graph.svelte:77`), before the mesh loop: if `upTween`,
   `t = Math.min(1, (performance.now() - start) / ms)`, `e = 1 - (1 - t) ** 2` (Quadratic.Out,
   matching the library's position tween), then
   `cam.up.copy(from).lerp(to, e).normalize()`; at `t >= 1` set `cam.up.copy(to)` and
   `upTween = null`. Lerp plus normalize on unit vectors is adequate here; the arc is short and
   `lookAt` re-orthogonalises each frame.
4. Call `levelCamera(ms)` in `flyTo` after the early returns (`Graph.svelte:62`), and
   `levelCamera(900)` immediately after `graph.zoomToFit(900, 60)` at `:125`.
5. In `onMount` after `Graph.svelte:120`: `graph.controls().staticMoving = true;` (Decision 5).
6. Dev only: `if (import.meta.env.DEV) window.__graph = graph;` for the console check below.

## Verification

- Tumble until the horizon is visibly tilted, then click a "show N nodes" pill in chat: the
  flight ends level and the un-roll is smooth, not a snap. Repeat via a node click
  (`Graph.svelte:118`) and via Reset → `zoomToFit`.
- Look straight down the tree from above (drag until the company node is centred and the tree
  recedes), then trigger a fly-to: no NaN camera, no flip; the view levels toward −Z.
- After any programmatic move, `__graph.camera().up` in the dev console reads `(0, 1, 0)` to
  three decimals (or `(0, 0, -1)` in the degenerate case).
- User tumble after the flight still rolls freely.
- Tumble, release mid-drag, and immediately click a node: no fight between inertia and the
  level tween (Decision 5).

## Out of scope

- Switching to OrbitControls (ruled out: users keep free tumble).
- Levelling on user-driven moves or when idle.
- The `dist` / `radius` heuristics in `flyTo` (`Graph.svelte:66-68`).
