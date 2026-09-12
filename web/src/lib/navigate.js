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

// step: -1 | +1. Null at either end — no wrap-around, because wrapping a
// three-item list is more disorienting than a key that does nothing.
export function siblingOf(tree, id, step) {
  const n = byId(tree, id);
  if (!n) return null;
  const sibs = tree.nodes.filter((s) => s.parent === n.parent);
  const i = sibs.findIndex((s) => s.id === id);
  if (i < 0) return null;
  return sibs[i + step] ?? null;
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
