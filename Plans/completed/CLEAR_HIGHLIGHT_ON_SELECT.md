---
tags:
  - plan
  - web
  - graph
status: completed
created: 2026-09-11
completed_on: 2026-09-11
---
# Plan: Clear chat highlights on any user selection in the 3D view

Concept: [OKR Viewer - Product Vision](../../Concepts/OKR%20Viewer%20-%20Product%20Vision.md)
(invariant 5: user gestures take precedence over assistant pointers). Spike plan.

## Context

`highlight` (`web/src/App.svelte:24`) holds the node ids from the last assistant reply;
`web/src/Graph.svelte:143-146` pulses them red and flies the camera. Nothing clears them except
Undo (`App.svelte:74`), Reset (`:81`), Import (`:121`) or the next reply. Once the user starts
clicking around, the red pulse is stale: it still says "this is what the assistant meant" over a
selection the user made.

Selection flows through `select(id)` at `App.svelte:131-133`, called from `Graph.svelte:118`
(node click), `:119` (background click → `null`), and the parent/child link buttons in
`web/src/Detail.svelte:27` and `:40`.

Drag vs click: `three-render-objects` already suppresses the click callback after a drag. A
`pointermove` past 1px while pressed sets `isPointerDragging`
(`web/node_modules/three-render-objects/dist/three-render-objects.mjs:520-530`), and
`pointerup` returns early when dragging unless `clickAfterDrag` is set (`:552-559`);
`clickAfterDrag` defaults to false (`:245`). So `onBackgroundClick` fires only for a true
click, not for the release of a tumble.

## Goal

Any user selection change in the scene (node click, background click to deselect, Detail link
click) clears the chat highlight; a tumble does not.

## Decisions (locked in)

1. **Clear in `select()`**, not in Graph. Every selection path already funnels through it, and
   Graph stays free of highlight policy.
2. **Background click clears too.** Interview answer 2026-09-11: clear on node clicks and
   background clicks, with the drag/click distinction preserved. The library already makes that
   distinction; this plan verifies it rather than re-implementing it.
3. **Chat recall stays.** The "show N nodes" pill (`web/src/Chat.svelte:51`) re-highlights on
   demand via `recall()` (`App.svelte:135-137`), so nothing is lost.

## Phase 1 — The change

1. `App.svelte:131-133`:
   ```js
   function select(id) {
     selectedId = id;
     if (highlight.length) highlight = []; // a user selection supersedes the assistant's pointer
   }
   ```
   The guard avoids re-running the Graph effect at `:143` when there is nothing to clear.
2. Dead zone, only if verification step 3 fails: in `Graph.svelte` `onMount`, record the
   `pointerdown` position on `el` and ignore `onBackgroundClick` when the pointer moved more
   than 4px before `pointerup`. Do not ship this pre-emptively.

## Verification

1. Ask "Which key results don't clearly support a company objective?", wait for the pulse,
   click a different node: pulse stops, the clicked node is selected, the camera flies to it.
2. Same, then click empty background: pulse stops, Detail closes, the camera does not move.
3. Same, then press on the background and drag to tumble: pulse continues, selection unchanged.
   Try short drags (5–10px) and touchpad drags. If any of these clear the highlight, implement
   Phase 1 step 2.
4. Click "show N nodes" on an earlier reply: pulse returns.
5. Click a parent link in Detail: pulse stops.

## Out of scope

- An explicit "clear highlights" button. Selection is the gesture.
- Clearing on hover or on typing in chat.

## Completion notes

- **Planned vs. actual:** Phase 1 step 1 shipped exactly as written — three lines in `select()`
  (`web/src/App.svelte:131-134`). No other file changed. `Graph.svelte` stayed untouched, so the
  highlight policy really does live in one place.
- **Mid-flight adjustments:** none. Phase 1 step 2 (the 4px dead zone) was deliberately not
  shipped: verification step 3 passed, so there was nothing to fix.
- **Surprises / residual risks:** `three-render-objects` is stricter than the plan assumed — for
  `pointerType === 'mouse'` *any* `pointermove` while pressed sets `isPointerDragging`
  (`web/node_modules/three-render-objects/dist/three-render-objects.mjs:519-530`), not just moves
  past 1px; the 1px relaxation applies to touch/pen only. So a tumble can never leak a click on a
  mouse or touchpad. Residual risk: a real touchscreen tap that wobbles ≤1px is still a click,
  which is the intended behaviour. Verification was run against a stubbed `/api/chat` (no API key
  in this environment) returning a fixed three-id highlight; the highlight path exercised is the
  same one a real reply takes.
