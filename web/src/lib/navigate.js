// Pure tree walking for the keyboard shortcuts: no Svelte, no three, so the
// arrow keys can be tested without a browser. `App.svelte` holds no tree logic
// beyond calling `step()`.
//
// The tree is flat with `parent` pointers, and its nodes are "in no particular
// order" per the schema, so `tree.nodes` order *is* the sibling order — it is
// what the Detail panel lists beneath a node, and left/right walk that list.

const byId = (tree, id) => tree.nodes.find((n) => n.id === id) ?? null;

// Exactly one node in a tree has a null parent.
export const rootOf = (tree) => tree.nodes.find((n) => n.parent === null) ?? null;

export function parentOf(tree, id) {
  const n = byId(tree, id);
  return n?.parent ? byId(tree, n.parent) : null;
}

export const firstChildOf = (tree, id) => tree.nodes.find((n) => n.parent === id) ?? null;

export const childrenOf = (tree, id) => tree.nodes.filter((n) => n.parent === id);

// step: -1 | +1, wrapping: right on the last sibling lands on the first, left
// on the first lands on the last. An only child still returns null, so a key
// that cannot go anywhere stays a no-op rather than re-selecting the node and
// re-flying the camera to where it already is.
export function siblingOf(tree, id, step) {
  const n = byId(tree, id);
  if (!n) return null;
  const sibs = tree.nodes.filter((s) => s.parent === n.parent);
  if (sibs.length < 2) return null;
  const i = sibs.findIndex((s) => s.id === id);
  if (i < 0) return null;
  // step is ±1, so i + step + length is never negative.
  return sibs[(i + step + sibs.length) % sibs.length];
}

// The frame a selection deserves: the node, what it rolls up to, and what rolls
// into it. Ids, in no particular order — the camera only averages positions.
// Returns [] for an id that is not in the tree, so a stale selection is a no-op.
export function neighborhoodOf(tree, id) {
  const n = tree.nodes.find((x) => x.id === id);
  if (!n) return [];
  const p = parentOf(tree, id);
  return [id, ...(p ? [p.id] : []), ...childrenOf(tree, id).map((c) => c.id)];
}

// The one entry point for the four arrows. With nothing selected any arrow
// selects the root, which is also the way in from a Teams panel.
export function step(tree, selectedId, dir) {
  if (!selectedId || !byId(tree, selectedId)) return rootOf(tree);
  switch (dir) {
    case 'up': return parentOf(tree, selectedId);
    case 'down': return firstChildOf(tree, selectedId);
    case 'left': return siblingOf(tree, selectedId, -1);
    case 'right': return siblingOf(tree, selectedId, 1);
    default: return null;
  }
}
