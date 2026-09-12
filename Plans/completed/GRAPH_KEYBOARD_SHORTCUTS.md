---
tags:
  - plan
  - web
  - graph
  - keyboard
status: completed
created: 2026-09-12
completed_on: 2026-09-12
---
# Plan: Add a keyboard shortcut system to the 3D view

Concept: [OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md)
(invariant 5: the user always feels in control of the view). Standard plan, one repo (`web/`).

## Context

The 3D view is mouse-only. Selection happens by clicking a sphere
(`web/src/Graph.svelte:220`, `onNodeClick` → `onSelect` + `flyTo`), and the only way to walk the
tree is the parent link (`web/src/Detail.svelte:320`) and child links (`:350-352`) in the Detail
panel. Framing the whole tree happens once, 700 ms after mount
(`Graph.svelte:238`: `zoomToFit(900, 60)` then `levelCamera(900)`), and never again; after a
tumble or a fly-to there is no way back to the overview except Reset, which also throws away the
tree.

There is already one keyboard shortcut. `App.svelte:482-490` handles `⌘Z`/`Ctrl+Z` → `undo()`
on a `<svelte:window onkeydown>` (`:492`), guarded so keys typed into an `INPUT`, `TEXTAREA` or
`SELECT` are left alone. It is a single `if`, not a table, so a second shortcut would be a
second `if`.

Everything the shortcuts need is already reachable from `App.svelte`:

- `selectedId` (`App.svelte:49`) and `select(id)` (`:445-452`), which every selection path funnels
  through: it opens the node panel, leaves edit mode and clears the assistant's highlight.
- The tree, flat with `parent` pointers (`schema/src/okr-node.schema.json`), so "up" is
  `node.parent`, "down" is the first node whose parent is this one, and siblings are the nodes
  that share a parent. Nodes are "in no particular order" (`okr-tree.schema.json`), so sibling
  order has to be chosen (Decision 3).
- `Graph.svelte` already exports `flyTo(ids, ms)` (`:119-139`), and the camera-levelling
  `levelCamera(ms)` (`:99-117`) is what `zoomToFit` needs beside it. The `Graph` component is
  mounted at `App.svelte:522` without a `bind:this`.

`TrackballControls` also listens for `keydown` on `window`
(`node_modules/three/examples/jsm/controls/TrackballControls.js:297`), but only for `KeyA`,
`KeyS`, `KeyD` (`:200`) as rotate/zoom/pan modifiers. `f` and the arrow keys are free.

## Goal

A single, table-driven shortcut registry in the web app, with `f` framing the whole tree and the
arrow keys walking the tree (up = parent, down = first child, left/right = previous/next
sibling), where each step selects the node and flies the camera to it exactly as a click would.

## Decisions (locked in)

1. **One registry, in `App.svelte`, replacing the `⌘Z` `if`.** Bindings are entries in a
   `SHORTCUTS` array (`keys`, `hint`, `run`, optional `mod`), and `onKey` becomes a lookup. The
   existing undo shortcut becomes the first entry so there is one path, not two. The pure tree
   walking lives in a new `web/src/lib/navigate.js` so it can be tested without Svelte.
2. **Arrows select through `select()`, then fly.** Same effect as a sphere click
   (`Graph.svelte:220`): the panel opens on the node, edit mode ends, the highlight clears
   (per `CLEAR_HIGHLIGHT_ON_SELECT`). The camera flies at 600 ms, a little shorter than the
   800 ms click flight, because arrow hops are short and may be repeated quickly.
3. **Sibling order is `tree.nodes` order.** That is the order the Detail panel lists children
   (`Detail.svelte:29`, `tree.nodes.filter(n => n.parent === node.id)`), so left/right walk the
   same list the panel shows, and "down" lands on the first entry of that list.
4. **No wrap-around, no-ops at the edges.** Right on the last sibling, left on the first, up on
   the root and down on a leaf do nothing. Predictable beats clever; wrap-around in a
   three-item list is disorienting.
5. **With nothing selected, any arrow selects the root** (the one node with `parent: null`).
   This is also the way in from a Teams panel: `select()` swaps the panel slot to the node.
6. **`f` moves the camera only.** It does not change selection and does not clear a highlight:
   framing is a view gesture, not a pointer, and invariant 5 asks only that programmatic moves
   level to world up, which `levelCamera` provides.
7. **Plain keys only, no modifiers, and never while typing.** The existing tag guard stays and
   gains `isContentEditable`. A plain binding does not fire when `meta`, `ctrl` or `alt` is
   held, so `⌘←` (browser back) and `⌘F` (find) keep working. `preventDefault` runs only when a
   binding actually ran, so arrows stop scrolling the page but nothing else is swallowed.
8. **Key repeat is allowed for arrows and ignored for `f`.** Holding right walks the siblings;
   holding `f` should not restart the frame flight every 30 ms.

## Phase 1 — Pure navigation helpers

New file `web/src/lib/navigate.js`, no imports from Svelte or three:

```js
export const rootOf = (tree) => tree.nodes.find((n) => n.parent === null) ?? null;
export const parentOf = (tree, id) => { const n = byId(tree, id); return n?.parent ? byId(tree, n.parent) : null; };
export const firstChildOf = (tree, id) => tree.nodes.find((n) => n.parent === id) ?? null;
export function siblingOf(tree, id, step) {      // step: -1 | +1; null at either end
  const n = byId(tree, id);
  if (!n) return null;
  const sibs = tree.nodes.filter((s) => s.parent === n.parent);
  const i = sibs.findIndex((s) => s.id === id);
  return sibs[i + step] ?? null;
}
// One entry point for the four arrows, so App.svelte holds no tree logic.
export function step(tree, selectedId, dir) {    // dir: 'up' | 'down' | 'left' | 'right'
  if (!selectedId) return rootOf(tree);
  ...
}
```

The root is `parent === null`, matching the schema's "exactly one node in a tree has a null
parent". Siblings of the root are just the root, so left/right at the root are no-ops for free.

Tests in `web/src/lib/navigate.test.js` with `node:test`, on a six-node fixture (root, two
objectives, three KRs under the first): parent of a KR is its objective; first child of the root
is the first objective in array order; right on the last KR is `null`; left on the first is
`null`; up on the root is `null`; `step` with no selection returns the root; `step('down')` on a
leaf returns `null`. Add `"test": "node --test \"src/**/*.test.js\""` to `web/package.json:6-10`,
mirroring `schema/package.json:25`.

## Phase 2 — Registry and wiring

1. `Graph.svelte`, after `flyTo` (`:139`): export the framing move so the mount-time call and the
   shortcut share it.
   ```js
   export function frameAll(ms = 900) {
     if (!graph) return;
     clearTimeout(hoverTimer);
     hovered = null;
     graph.zoomToFit(ms, 60);
     levelCamera(ms);
   }
   ```
   Replace the body of the `setTimeout` at `:238` with `frameAll(900)`.
2. `App.svelte:522`: `<Graph bind:this={graph} ... />`, with `let graph;` beside `fileInput`
   (`:400`). Svelte 5 exposes a component's `export function`s on the bound instance.
3. `App.svelte`, above `onKey`: a `go(dir)` that does the arrow work in one place.
   ```js
   function go(dir) {
     const next = step(tree, selectedId, dir);
     if (!next) return;
     select(next.id);
     graph?.flyTo([next.id], 600);
   }
   ```
4. `App.svelte`, replacing `:482-490`: the registry and the lookup.
   ```js
   const SHORTCUTS = [
     { keys: ['z'], mod: true, hint: '⌘Z undo', run: undo },
     { keys: ['f'], hint: 'F frame tree', run: () => graph?.frameAll(), repeat: false },
     { keys: ['ArrowUp'], hint: '↑ parent', run: () => go('up') },
     { keys: ['ArrowDown'], hint: '↓ first child', run: () => go('down') },
     { keys: ['ArrowLeft'], hint: '← previous sibling', run: () => go('left') },
     { keys: ['ArrowRight'], hint: '→ next sibling', run: () => go('right') }
   ];

   function onKey(e) {
     const t = e.target;
     if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable) return;
     const mod = e.metaKey || e.ctrlKey;
     const hit = SHORTCUTS.find((s) => s.keys.includes(e.key) && !!s.mod === mod && !e.altKey);
     if (!hit || (e.repeat && hit.repeat === false)) return;
     e.preventDefault();
     hit.run();
   }
   ```
   `keys` is an array so a later entry can bind two keys to one action (`?` and `/`, say)
   without changing the lookup. The `⌘Z` `title` on the Undo button (`App.svelte:510`) stays as
   it is.

## Phase 3 — Discoverability (independently shippable)

The legend at `App.svelte:569-576` is the one always-visible strip over the stage. Add a second
row rendered from the registry, so the hint text has one source of truth:

```svelte
<span class="keys">{SHORTCUTS.map((s) => s.hint).join(' · ')}</span>
```

Style it in `web/src/app.css` beside `.legend` (`:80-91`): muted, smaller, `flex-basis: 100%` so
it wraps under the swatches. The legend is `pointer-events: none`, which is right for text. A
`title` on the graph container is not an option: `three-render-objects` owns that element's
pointer events and a tooltip would fight the hover card.

## Verification

Build and test run inside the `dev` container (host Node is 12), and the built `web/dist` is
served from the host for the browser checks.

1. `docker exec -w /src/web dev npm test` passes the Phase 1 cases.
2. Fresh load, nothing selected: `→` selects the company root and flies to it; `↓` then selects
   the first objective the Detail panel lists under it; `↓` again selects that objective's first
   KR; `→`/`←` walk the KRs in the same order the panel's "beneath it" list shows; `←` on the
   first KR does nothing; `↑` twice returns to the root; `↑` again does nothing.
3. Tumble until the view is rolled, then press `f`: the whole tree fits the viewport, the
   horizon levels during the flight (same as Reset used to look), selection and any red
   highlight are untouched.
4. Ask the chat a question that highlights nodes, wait for the pulse, then press `↓`: the pulse
   clears and the panel opens on the new node (same as a click).
5. Click into the chat textarea and press `↑`, `↓`, `f`: the caret moves and `f` types. Same in
   a Detail field while editing, and in the dataset `<select>` (arrows change the option).
6. `⌘Z` still undoes; `⌘←` still goes back in the browser; `⌘F` still opens find.
7. Hold `→` on a wide sibling list: the selection walks without skipping and the camera does not
   judder or fight itself (see Risks).
8. Open the Teams panel, press `↓`: the root is selected and the node panel replaces the team
   panel.

## Out of scope

- `Escape` to deselect or close the panel, `Enter` to enter edit mode, `Home`/`End`,
  number keys for levels. Each is one registry entry later; this plan lands the registry.
- A `?` cheat-sheet overlay. The legend row is enough until the table has more than a handful
  of entries.
- User-rebindable keys or persisted preferences. Nothing persists yet (Horizon 3).
- Remembering which child you came up from, so `↑` then `↓` returns there. Nice, but it needs
  per-node memory that the selection model does not have.
- Focus management, `tabindex` on spheres, or screen-reader announcements for the scene.
- Keyboard shortcuts inside the Detail, Team or Chat panels beyond what they already have.

## Risks / rollback

- **Repeated `flyTo` calls while a flight is running.** `cameraPosition()` in
  `three-render-objects` calls `.end()` on the running position and look-at tweens before
  starting new ones (`web/node_modules/three-render-objects/dist/three-render-objects.mjs:319-320`),
  which jumps the camera to the *previous* destination first. So holding `→` may show a small
  snap per step rather than a judder (verification step 7). If it is visible, `go()` should
  debounce: select immediately, fly on a 60 ms trailing timer, so a held key produces one flight
  to the final node. `levelCamera` is safe to re-arm; it overwrites `upTween`.
- **A `bind:this` on a component** gives an instance whose exports exist only after mount.
  `graph?.` guards every call, and `onKey` cannot fire before mount in practice.
- **Rollback** is removing the registry and restoring the eight-line `onKey`; nothing in the
  document, schema or service changes.

## Completion notes

- **Planned vs. actual.** The plan executed as written, `file:line` citations included; every
  one still pointed at the right code. `navigate.js`, the `frameAll` export, the `SHORTCUTS`
  table and the legend row all landed in the shape the plan specified, and all eight
  verification steps pass. Phase 3 shipped with Phase 2 rather than separately — it is four
  lines once the registry exists.
- **Mid-flight adjustments.** Two. (a) `.legend` moved from `bottom: 12px` to `bottom: 24px`:
  the hint row's `flex-basis: 100%` widens the legend to the full stage, which put it on top of
  the mouse-control hint `three-render-objects` prints in the bottom 19px. The old single-row
  legend escaped this only because it is right-aligned and the nav text is centred. (b)
  `step()` falls back to the root when `selectedId` names a node that is no longer in the tree,
  not just when it is null — a dataset switch or an undo can strand a selection, and an arrow
  key should recover rather than dead-end. Covered by a test.
- **Surprises / residual risks.** The `three-render-objects` snap described under Risks could
  not be judged: the up-tween and the camera tween are both driven by `requestAnimationFrame`,
  and an automated browser pane only paints when something forces it, so a held arrow advances
  one frame per forced paint. The *logic* under repeat is verified — held `f` ignored, held
  arrows walk five siblings in panel order without skipping — but whether a fast held arrow
  judders visibly still needs a human at a real keyboard. If it does, the fix is the trailing
  60 ms debounce in `go()` the plan already sketched; `select()` should stay immediate so the
  panel keeps up with the key.
