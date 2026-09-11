// applyAction(tree, action) → new tree.
//
// Pure: never mutates the input. Untouched node objects are reused by
// reference so the graph can diff by identity and keep its layout warm.
//
// The JSDoc types come from @okr-viewer/schema's generated declarations, so an
// editor checks this file against the same schema the service validates with,
// without either package adopting TypeScript.

/**
 * @typedef {import('@okr-viewer/schema').OkrTree} OkrTree
 * @typedef {import('@okr-viewer/schema').OkrNode} OkrNode
 * @typedef {import('@okr-viewer/schema').Action} Action
 */

const EDITABLE = ['label', 'owner', 'metric', 'target', 'contributes', 'parent'];

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

function pick(fields = {}, extra = []) {
  const out = {};
  for (const k of [...EDITABLE, ...extra]) if (k in fields) out[k] = fields[k];
  if ('contributes' in out) out.contributes = clamp01(Number(out.contributes));
  return out;
}

/**
 * Every node below `id`, transitively.
 * @param {OkrTree} tree
 * @param {string} id
 * @returns {Set<string>}
 */
export function descendants(tree, id) {
  const out = new Set();
  let frontier = [id];
  while (frontier.length) {
    const next = tree.nodes.filter((n) => frontier.includes(n.parent)).map((n) => n.id);
    frontier = next.filter((x) => !out.has(x));
    frontier.forEach((x) => out.add(x));
  }
  return out;
}

function wouldCycle(tree, id, newParent) {
  if (!newParent) return false;
  if (newParent === id) return true;
  return descendants(tree, id).has(newParent);
}

/**
 * Apply one action, returning a new tree. Anything that does not fit the tree
 * (an unknown id, a parent that would make a cycle) is ignored rather than
 * thrown — the service has already filtered the model's output.
 * @param {OkrTree} tree
 * @param {Action} action
 * @returns {OkrTree}
 */
export function applyAction(tree, action) {
  if (!action || typeof action.id !== 'string') return tree;
  const { op, id } = action;
  const exists = tree.nodes.some((n) => n.id === id);

  switch (op) {
    case 'edit':
    case 'relink': {
      if (!exists) return tree;
      const fields = pick(action.fields);
      if ('parent' in fields && wouldCycle(tree, id, fields.parent)) delete fields.parent;
      if (!Object.keys(fields).length) return tree;
      return { nodes: tree.nodes.map((n) => (n.id === id ? { ...n, ...fields } : n)) };
    }

    case 'add': {
      if (exists) return applyAction(tree, { ...action, op: 'edit' });
      const node = {
        id,
        level: 'kr',
        parent: null,
        label: '(untitled)',
        owner: '',
        metric: '',
        target: '',
        contributes: 0.5,
        ...pick(action.fields, ['level'])
      };
      return { nodes: [...tree.nodes, node] };
    }

    case 'delete': {
      if (!exists) return tree;
      const gone = descendants(tree, id);
      gone.add(id);
      return { nodes: tree.nodes.filter((n) => !gone.has(n.id)) };
    }

    default:
      return tree;
  }
}

/**
 * @param {OkrTree} tree
 * @param {Action[]} actions
 * @returns {OkrTree}
 */
export function applyActions(tree, actions = []) {
  return actions.reduce(applyAction, tree);
}
