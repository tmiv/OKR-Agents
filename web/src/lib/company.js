// applyUnitAction(company, action) → new company.
//
// The org half of apply.js, and pure in exactly the same way: never mutates the
// input, returns the same object when an action does not apply, and reuses
// untouched unit objects by reference.
//
// Teams live in `company.units`, flat with parent pointers, in the same style
// as the tree — so the rules here read like apply.js on purpose: an unknown id
// is ignored, a parent that would make a cycle is dropped rather than thrown.

/**
 * @typedef {import('@okr-agents/schema').Company} Company
 * @typedef {import('@okr-agents/schema').CompanyUnit} CompanyUnit
 * @typedef {import('@okr-agents/schema').Action} Action
 */

const CHARTER_KEYS = ['mission', 'process', 'owns', 'dependsOn'];

/** An empty org, for a document that arrived without one. */
export const emptyCompany = (name = 'Untitled') => ({ name, units: [] });

const unitsOf = (company) => (Array.isArray(company?.units) ? company.units : []);

/**
 * Display name of a team, or null when the id names nothing (a deleted team, a
 * document with no `company`). Callers fall back to the node's `owner` text.
 * @param {Company | null | undefined} company
 * @param {string | null | undefined} id
 * @returns {string | null}
 */
export function unitName(company, id) {
  if (!id) return null;
  return unitsOf(company).find((u) => u.id === id)?.name ?? null;
}

/**
 * Whether a team has enough written down to speak as itself: a mission, a
 * process, or at least one key result it owns. A persona with nothing written
 * down is the assistant doing an impression, so both front doors onto the
 * persona mode — the briefing card and the team panel — gate on this, and on
 * this only, so they cannot disagree about which teams can talk.
 * @param {CompanyUnit | null | undefined} unit
 * @returns {boolean}
 */
export function hasCharter(unit) {
  const charter = unit?.charter;
  return Boolean(charter && (charter.mission || charter.process || charter.owns?.length));
}

/**
 * Every team below `id`, transitively.
 * @param {Company | null | undefined} company
 * @param {string} id
 * @returns {Set<string>}
 */
export function unitDescendants(company, id) {
  const units = unitsOf(company);
  const out = new Set();
  let frontier = [id];
  while (frontier.length) {
    const next = units.filter((u) => frontier.includes(u.parent)).map((u) => u.id);
    frontier = next.filter((x) => !out.has(x));
    frontier.forEach((x) => out.add(x));
  }
  return out;
}

function wouldCycle(company, id, newParent) {
  if (!newParent) return false;
  if (newParent === id) return true;
  return unitDescendants(company, id).has(newParent);
}

// A charter edit is a shallow merge, one field at a time: the model that knows
// only the mission must not be able to blank out the process by omission.
function mergeCharter(existing, patch) {
  const out = { ...existing };
  for (const k of CHARTER_KEYS) if (k in patch) out[k] = patch[k];
  // An empty charter is noise in the document; drop it rather than store `{}`.
  return Object.keys(out).length ? out : undefined;
}

function pickUnitFields(company, id, fields = {}) {
  const out = {};
  if (typeof fields.name === 'string' && fields.name.trim()) out.name = fields.name.trim();
  if ('parent' in fields && !wouldCycle(company, id, fields.parent)) out.parent = fields.parent ?? null;
  if (typeof fields.lead === 'string') out.lead = fields.lead;
  return out;
}

/**
 * Apply one unit action, returning a new company. Node ops are not this
 * function's business — applyDocumentActions routes them.
 *
 * `deleteUnit` never cascades: teams under the one being removed move up to its
 * parent. Deleting "Marketing" must not silently take Content and Field
 * Marketing with it, the way deleting a node takes its subtree.
 *
 * @param {Company} company
 * @param {Action} action
 * @returns {Company}
 */
export function applyUnitAction(company, action) {
  if (!company || !action || typeof action.id !== 'string') return company;
  const { op, id } = action;
  const units = unitsOf(company);
  const existing = units.find((u) => u.id === id) ?? null;

  switch (op) {
    case 'editUnit': {
      if (!existing) return company;
      const fields = pickUnitFields(company, id, action.fields);
      const charter =
        action.fields && 'charter' in action.fields ? mergeCharter(existing.charter, action.fields.charter ?? {}) : undefined;
      if (!Object.keys(fields).length && charter === undefined) return company;
      const next = { ...existing, ...fields };
      if (charter !== undefined) next.charter = charter;
      else if (action.fields && 'charter' in action.fields) delete next.charter;
      return { ...company, units: units.map((u) => (u.id === id ? next : u)) };
    }

    case 'addUnit': {
      if (existing) return applyUnitAction(company, { ...action, op: 'editUnit' });
      const fields = action.fields ?? {};
      const unit = { id, name: String(fields.name ?? 'New team').trim() || 'New team', parent: fields.parent ?? null };
      if (unit.parent != null && !units.some((u) => u.id === unit.parent)) unit.parent = null;
      const charter = mergeCharter(undefined, fields.charter ?? {});
      if (charter) unit.charter = charter;
      return { ...company, units: [...units, unit] };
    }

    case 'deleteUnit': {
      if (!existing) return company;
      const up = existing.parent ?? null;
      const next = units
        .filter((u) => u.id !== id)
        .map((u) => {
          // Children move up; anyone who depended on the team stops depending
          // on a ghost.
          const reparented = u.parent === id ? { ...u, parent: up } : u;
          const deps = reparented.charter?.dependsOn;
          if (!deps?.includes(id)) return reparented;
          const kept = deps.filter((d) => d !== id);
          const charter = { ...reparented.charter };
          if (kept.length) charter.dependsOn = kept;
          else delete charter.dependsOn;
          return { ...reparented, charter: Object.keys(charter).length ? charter : undefined };
        })
        .map((u) => (u.charter === undefined && 'charter' in u ? (({ charter, ...rest }) => rest)(u) : u));
      return { ...company, units: next };
    }

    default:
      return company;
  }
}
