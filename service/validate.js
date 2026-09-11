// Claude will occasionally invent node IDs. Everything it sends back is
// filtered against the tree the browser sent us, so nothing unknown reaches
// the renderer.

const LEVELS = new Set(['company', 'objective', 'kr']);
const TEXT_FIELDS = ['label', 'owner', 'metric', 'target'];
const MAX_TEXT = 400;

export function validateTree(tree) {
  if (!tree || !Array.isArray(tree.nodes)) return 'tree.nodes must be an array';
  if (tree.nodes.length > 500) return 'tree is too large (max 500 nodes)';
  const ids = new Set();
  for (const n of tree.nodes) {
    if (!n || typeof n.id !== 'string' || !n.id) return 'every node needs a string id';
    if (ids.has(n.id)) return `duplicate node id "${n.id}"`;
    ids.add(n.id);
  }
  return null;
}

// Keep only well-formed turns, cap the length, and merge consecutive
// same-role turns so the API always sees strict user/assistant alternation.
export function sanitizeHistory(history, maxTurns = 12) {
  const turns = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-maxTurns)
    .map((m) => ({ role: m.role, content: m.content.trim() }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return mergeTurns(turns);
}

export function mergeTurns(turns) {
  const out = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += '\n\n' + t.content;
    else out.push({ ...t });
  }
  return out;
}

function cleanFields(raw, { allowLevel = false } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of TEXT_FIELDS) {
    if (k in src && src[k] != null) out[k] = String(src[k]).trim().slice(0, MAX_TEXT);
  }
  if ('contributes' in src) {
    const n = Number(src.contributes);
    if (Number.isFinite(n)) out.contributes = Math.min(1, Math.max(0, n));
  }
  if ('parent' in src) out.parent = src.parent == null ? null : String(src.parent);
  if (allowLevel && LEVELS.has(src.level)) out.level = src.level;
  return out;
}

export function validateResponse(tree, input) {
  const known = new Set(tree.nodes.map((n) => n.id));
  const parentOf = new Map(tree.nodes.map((n) => [n.id, n.parent]));
  const dropped = [];
  const actions = [];

  const isAncestorOrSelf = (candidate, id) => {
    let cur = candidate;
    for (let i = 0; cur != null && i < 1000; i++) {
      if (cur === id) return true;
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };

  const validParent = (id, parent) => parent != null && known.has(parent) && !isAncestorOrSelf(parent, id);

  for (const a of Array.isArray(input?.actions) ? input.actions : []) {
    const reject = (reason) => dropped.push({ action: a, reason });
    if (!a || typeof a.id !== 'string' || !a.id) { reject('missing id'); continue; }
    const { op, id } = a;

    if (op === 'edit' || op === 'relink') {
      if (!known.has(id)) { reject(`unknown id ${id}`); continue; }
      const fields = cleanFields(a.fields);
      if ('parent' in fields && !validParent(id, fields.parent)) {
        reject(`bad parent ${fields.parent} for ${id}`);
        delete fields.parent;
      }
      if (op === 'relink' && !('parent' in fields)) continue;
      if (!Object.keys(fields).length) { reject('no usable fields'); continue; }
      if ('parent' in fields) parentOf.set(id, fields.parent);
      actions.push({ op, id, fields });
    } else if (op === 'add') {
      if (known.has(id)) { reject(`add with existing id ${id}`); continue; }
      const fields = cleanFields(a.fields, { allowLevel: true });
      if (!fields.label) { reject('add without label'); continue; }
      if (!fields.level || fields.level === 'company') fields.level = 'kr';
      if (!(fields.parent != null && known.has(fields.parent))) { reject(`add with bad parent ${fields.parent}`); continue; }
      known.add(id);
      parentOf.set(id, fields.parent);
      actions.push({ op, id, fields });
    } else if (op === 'delete') {
      if (!known.has(id)) { reject(`unknown id ${id}`); continue; }
      const gone = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [child, parent] of parentOf) {
          if (gone.has(parent) && !gone.has(child)) { gone.add(child); grew = true; }
        }
      }
      for (const g of gone) { known.delete(g); parentOf.delete(g); }
      actions.push({ op, id });
    } else {
      reject(`unknown op ${op}`);
    }
  }

  const highlight = [
    ...new Set((Array.isArray(input?.highlight) ? input.highlight : []).filter((id) => typeof id === 'string' && known.has(id)))
  ];

  const reply =
    typeof input?.reply === 'string' && input.reply.trim()
      ? input.reply.trim()
      : actions.length
        ? 'Done.'
        : "I couldn't come up with an answer for that — try rephrasing.";

  return { reply, actions, highlight, dropped };
}
