// Claude will occasionally invent node IDs. Everything it sends back is
// filtered against the tree the browser sent us, so nothing unknown reaches
// the renderer.
//
// Two layers, and the split matters:
//
//   @okr-viewer/schema's validateAction()  — shape. Is this an action at all?
//   the checks below                       — reference. Does it fit *this* tree?
//
// Shape lives in the package because the browser needs the same answer. The
// referential checks are tree-relative and stay here.

import { validateAction } from '@okr-viewer/schema';

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

    // Shape first: op, id and the per-op field whitelist all come from the
    // shared schema, so anything past here has the keys it claims to have.
    const shape = validateAction(a);
    if (!shape.ok) {
      reject(shape.errors.join('; '));
      continue;
    }

    const { op, id } = a;
    const fields = { ...a.fields };

    if (op === 'edit' || op === 'relink') {
      if (!known.has(id)) { reject(`unknown id ${id}`); continue; }
      if ('parent' in fields && !validParent(id, fields.parent)) {
        reject(`bad parent ${fields.parent} for ${id}`);
        delete fields.parent;
      }
      // A relink whose only field was the rejected parent has nothing left.
      if (!Object.keys(fields).length) { reject('no usable fields'); continue; }
      if ('parent' in fields) parentOf.set(id, fields.parent);
      actions.push({ op, id, fields });
    } else if (op === 'add') {
      if (known.has(id)) { reject(`add with existing id ${id}`); continue; }
      // The model is never allowed to mint a second company root.
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
