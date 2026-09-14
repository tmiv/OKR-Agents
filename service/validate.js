// Claude will occasionally invent node IDs. Everything it sends back is
// filtered against the tree the browser sent us, so nothing unknown reaches
// the renderer.
//
// Two layers, and the split matters:
//
//   @okr-agents/schema's validateAction()  — shape. Is this an action at all?
//   the checks below                       — reference. Does it fit *this* tree?
//
// Shape lives in the package because the browser needs the same answer. The
// referential checks are tree-relative and stay here.

import { validateAction } from '@okr-agents/schema';

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

// The browser's view context, filtered against the document it came with.
//
// Context is advisory: it says what the user is looking at, and being wrong
// about that is never worth a 400. A panel pointed at a node or team that this
// tree does not have names nothing, so the whole panel goes; highlights are
// filtered one by one. Everything dropped is reported so the caller can log
// it — a context that keeps arriving broken is a client bug worth seeing.
export function sanitizeContext(tree, company, context) {
  const dropped = [];
  if (!context || typeof context !== 'object') return { context: null, dropped };

  const known = new Set(tree.nodes.map((n) => n.id));
  const knownUnits = new Set((Array.isArray(company?.units) ? company.units : []).map((u) => u.id));

  let panel = null;
  if (context.panel) {
    const { kind, id = null, editing, field } = context.panel;
    const needed = kind === 'node' ? known : kind === 'team' ? knownUnits : null;
    if (needed && !(typeof id === 'string' && needed.has(id))) {
      dropped.push(`panel ${kind}:${id ?? 'none'}`);
    } else {
      panel = { kind };
      if (id != null) panel.id = id;
      if (typeof editing === 'boolean') panel.editing = editing;
      if (field) panel.field = field;
    }
  }

  const wanted = Array.isArray(context.highlighted) ? context.highlighted : [];
  const highlighted = wanted.filter((id) => known.has(id));
  if (highlighted.length !== wanted.length) {
    dropped.push(`highlighted ${wanted.filter((id) => !known.has(id)).join(', ')}`);
  }

  const dataset = typeof context.dataset === 'string' ? context.dataset.trim() : '';
  return { context: { panel, highlighted, ...(dataset ? { dataset } : {}) }, dropped };
}

// What the tab says it is about, checked against the document it came with.
//
// Same spirit as sanitizeContext: a subject that names nothing is a tab whose
// subject has been deleted, imported away or switched out from under it, and
// that is never worth a 400 on a message the user has already typed. The mode
// falls back to `free` and the reason is reported so it can be logged — a
// client that keeps sending subjects this tree does not have is a bug worth
// seeing.
//
// `interview-new` is the one case that survives a bad reference: a parent that
// is gone leaves a perfectly good interview about a node that does not exist
// yet, so only the parent is dropped and the model asks which objective it
// supports instead.
export function resolveTab(tree, company, mode, subject) {
  const free = (dropped = null) => ({ mode: 'free', subject: null, dropped });
  if (!mode || mode === 'free') return free();

  const known = new Set(tree.nodes.map((n) => n.id));
  const knownUnits = new Set((Array.isArray(company?.units) ? company.units : []).map((u) => u.id));

  if (mode === 'interview-node') {
    if (subject?.kind !== 'node') return free('no node subject — falling back to free');
    if (!known.has(subject.id)) return free(`node ${subject.id} is not in this tree — falling back to free`);
    return { mode, subject: { kind: 'node', id: subject.id }, dropped: null };
  }

  // Both team modes resolve identically: one names the team being interviewed,
  // the other the team being spoken as, and either way the id has to be a team
  // this org still has.
  if (mode === 'interview-team' || mode === 'persona') {
    if (subject?.kind !== 'team') return free('no team subject — falling back to free');
    if (!knownUnits.has(subject.id)) return free(`team ${subject.id} is not in this org — falling back to free`);
    return { mode, subject: { kind: 'team', id: subject.id }, dropped: null };
  }

  if (mode === 'interview-new') {
    if (subject?.kind !== 'new') return free('no new-node subject — falling back to free');
    const parentId = subject.parentId ?? null;
    if (parentId != null && !known.has(parentId)) {
      return {
        mode,
        subject: { kind: 'new', parentId: null },
        dropped: `parent ${parentId} is not in this tree — asking for one instead`
      };
    }
    return { mode, subject: { kind: 'new', parentId }, dropped: null };
  }

  // An audit is the one mode with nothing to resolve: nobody typed it, and it
  // is about the whole document rather than one node or team. There is no
  // subject to lose, so there is no way for it to fall back.
  if (mode === 'audit') return { mode, subject: null, dropped: null };

  return free(`unknown mode ${mode} — falling back to free`);
}

// The reference filter over one batch of actions, run against a private copy of
// the tree's id sets. `validateResponse` runs it once over the reply's actions;
// an audit runs it once per finding, because the user applies findings one at a
// time and in any order — a fix must stand on its own, not on another finding's
// fix having landed first.
//
// `allowDelete: false` is for those per-finding runs: the audit prompt forbids
// a fix that deletes, and a prompt is not an enforcement mechanism.
//
// `known` comes back with the batch's own adds and deletes folded in, because
// the caller filters `highlight` against the tree the actions leave behind.
export function validateActions(tree, company, input, { allowDelete = true } = {}) {
  const known = new Set(tree.nodes.map((n) => n.id));
  const parentOf = new Map(tree.nodes.map((n) => [n.id, n.parent]));
  // Teams are filtered exactly like nodes, and against the same moving target:
  // an addUnit earlier in the batch makes its id usable by a later action.
  const knownUnits = new Set((Array.isArray(company?.units) ? company.units : []).map((u) => u.id));
  const unitParentOf = new Map((Array.isArray(company?.units) ? company.units : []).map((u) => [u.id, u.parent ?? null]));
  const dropped = [];
  const actions = [];

  const isUnitAncestorOrSelf = (candidate, id) => {
    let cur = candidate;
    for (let i = 0; cur != null && i < 1000; i++) {
      if (cur === id) return true;
      cur = unitParentOf.get(cur) ?? null;
    }
    return false;
  };

  const isAncestorOrSelf = (candidate, id) => {
    let cur = candidate;
    for (let i = 0; cur != null && i < 1000; i++) {
      if (cur === id) return true;
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };

  const validParent = (id, parent) => parent != null && known.has(parent) && !isAncestorOrSelf(parent, id);

  for (const a of Array.isArray(input) ? input : []) {
    const reject = (reason) => dropped.push({ action: a, reason });

    if (!allowDelete && (a?.op === 'delete' || a?.op === 'deleteUnit')) {
      reject('a fix may not delete');
      continue;
    }

    // Shape first: op, id and the per-op field whitelist all come from the
    // shared schema, so anything past here has the keys it claims to have.
    const shape = validateAction(a);
    if (!shape.ok) {
      reject(shape.errors.join('; '));
      continue;
    }

    const { op, id } = a;
    const fields = { ...a.fields };

    // Teams the model made up are dropped the same way node ids are, so
    // nothing unknown reaches the browser's apply layer.
    const badUnitRef = (value) => value != null && !knownUnits.has(value);
    const keepKnownDeps = (charter) => {
      if (!Array.isArray(charter?.dependsOn)) return charter;
      const kept = charter.dependsOn.filter((d) => knownUnits.has(d) && d !== id);
      if (kept.length === charter.dependsOn.length) return charter;
      reject(`dropped unknown dependsOn entries for ${id}`);
      return { ...charter, dependsOn: kept };
    };

    if (op === 'edit' || op === 'relink') {
      if (!known.has(id)) { reject(`unknown id ${id}`); continue; }
      if ('parent' in fields && !validParent(id, fields.parent)) {
        reject(`bad parent ${fields.parent} for ${id}`);
        delete fields.parent;
      }
      if ('unitId' in fields && badUnitRef(fields.unitId)) {
        reject(`unknown team ${fields.unitId} for ${id}`);
        delete fields.unitId;
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
      if ('unitId' in fields && badUnitRef(fields.unitId)) {
        reject(`unknown team ${fields.unitId} for ${id}`);
        delete fields.unitId;
      }
      known.add(id);
      parentOf.set(id, fields.parent);
      actions.push({ op, id, fields });
    } else if (op === 'editUnit') {
      if (!knownUnits.has(id)) { reject(`unknown team ${id}`); continue; }
      if ('parent' in fields && fields.parent != null) {
        // A team cannot move under itself or under one of its own children.
        if (!knownUnits.has(fields.parent) || isUnitAncestorOrSelf(fields.parent, id)) {
          reject(`bad parent ${fields.parent} for team ${id}`);
          delete fields.parent;
        }
      }
      if ('charter' in fields) fields.charter = keepKnownDeps(fields.charter);
      if (!Object.keys(fields).length) { reject('no usable fields'); continue; }
      if ('parent' in fields) unitParentOf.set(id, fields.parent ?? null);
      actions.push({ op, id, fields });
    } else if (op === 'addUnit') {
      if (knownUnits.has(id)) { reject(`addUnit with existing id ${id}`); continue; }
      if (fields.parent != null && !knownUnits.has(fields.parent)) {
        reject(`addUnit with bad parent ${fields.parent}`);
        fields.parent = null;
      }
      knownUnits.add(id);
      unitParentOf.set(id, fields.parent ?? null);
      if ('charter' in fields) fields.charter = keepKnownDeps(fields.charter);
      actions.push({ op, id, fields });
    } else if (op === 'deleteUnit') {
      if (!knownUnits.has(id)) { reject(`unknown team ${id}`); continue; }
      // Deleting a team never cascades: its children move up to its parent, so
      // only the team itself leaves the known set.
      const up = unitParentOf.get(id) ?? null;
      for (const [child, parent] of unitParentOf) if (parent === id) unitParentOf.set(child, up);
      knownUnits.delete(id);
      unitParentOf.delete(id);
      actions.push({ op, id });
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

  return { actions, dropped, known };
}

// Schema lengths, clamped here rather than rejected: a title two characters
// over is a card with a long title, not a finding worth throwing away.
const MAX_TITLE = 80;
const MAX_WHY = 300;
const MAX_FINDINGS = 8;
const MAX_NODE_IDS = 20;
const SEVERITIES = new Set(['high', 'medium', 'low']);

// Clamped rather than rejected: a title a few characters over is a card with a
// long title, not a finding worth throwing away. Cut back to a word boundary
// when there is one nearby — "…the whole b" reads like a bug, "…the whole…"
// reads like a sentence that was too long, which is what happened.
function clamp(text, max) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// An audit's findings, filtered against the tree the browser sent.
//
// A finding is only worth showing if the user can look at what it is about, so
// one whose `nodeIds` all name nothing is dropped outright. A finding whose
// `fix` does not survive keeps its card and loses its Fix button: "these three
// key results are activities" is worth reading even when the model's proposed
// rewrite named an id that is gone.
function validateFindings(tree, company, input) {
  const inTree = new Set(tree.nodes.map((n) => n.id));
  const dropped = [];
  const findings = [];

  for (const f of (Array.isArray(input) ? input : []).slice(0, MAX_FINDINGS)) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      dropped.push({ finding: f, reason: 'not an object' });
      continue;
    }
    const title = typeof f.title === 'string' ? clamp(f.title, MAX_TITLE) : '';
    const why = typeof f.why === 'string' ? clamp(f.why, MAX_WHY) : '';
    if (!title || !why) {
      dropped.push({ finding: f.title ?? f, reason: 'no title or no why' });
      continue;
    }

    const wanted = (Array.isArray(f.nodeIds) ? f.nodeIds : []).filter((id) => typeof id === 'string');
    const nodeIds = [...new Set(wanted.filter((id) => inTree.has(id)))].slice(0, MAX_NODE_IDS);
    if (!nodeIds.length) {
      dropped.push({ finding: title, reason: `names no node in this tree (${wanted.join(', ') || 'none'})` });
      continue;
    }
    if (nodeIds.length !== wanted.length) {
      dropped.push({ finding: title, reason: `unknown nodeIds ${wanted.filter((id) => !inTree.has(id)).join(', ')}` });
    }

    // Fresh id sets per finding: the user applies these one at a time and in
    // whatever order they like, so nothing here may lean on another finding.
    const fix = validateActions(tree, company, f.fix, { allowDelete: false });
    for (const d of fix.dropped) dropped.push({ finding: title, ...d });

    findings.push({
      title,
      why,
      severity: SEVERITIES.has(f.severity) ? f.severity : 'medium',
      nodeIds,
      fix: fix.actions
    });
  }

  return { findings, dropped };
}

export function validateResponse(tree, company, input) {
  const { actions, dropped, known } = validateActions(tree, company, input?.actions);
  const audit = validateFindings(tree, company, input?.findings);
  dropped.push(...audit.dropped);

  const highlight = [
    ...new Set((Array.isArray(input?.highlight) ? input.highlight : []).filter((id) => typeof id === 'string' && known.has(id)))
  ];

  const reply =
    typeof input?.reply === 'string' && input.reply.trim()
      ? input.reply.trim()
      : actions.length
        ? 'Done.'
        : "I couldn't come up with an answer for that — try rephrasing.";

  return { reply, actions, highlight, findings: audit.findings, dropped };
}
