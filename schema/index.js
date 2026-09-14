// @okr-agents/schema — the one authoritative description of the OKR document,
// shared by web/ and service/.
//
// Two layers, kept apart on purpose (see the plan's Decision 6):
//
//   validateX()          structural. Generated from JSON Schema, no opinions.
//   checkTreeSemantics() relational. Uniqueness, parent existence, cycles,
//                        exactly one root — things JSON Schema cannot express.
//
// Callers never see raw Ajv error objects; errors come back as
// "instancePath: message" strings that are safe to show a user.

// Nothing here touches a Node built-in or a JSON import: the same file is
// bundled for the browser by Vite and loaded directly by the service. The
// package version and the tool schema arrive as generated ESM (dist/meta.js)
// rather than a fs read or an import attribute, which only Node understands.

import { MIGRATIONS, migrate } from './migrations/index.js';
import { SCHEMA_VERSION } from './version.js';
import { PACKAGE_VERSION, RESPOND_INPUT_SCHEMA } from './dist/meta.js';
import {
  validateAction as _validateAction,
  validateAddAction as _validateAddAction,
  validateAddUnitAction as _validateAddUnitAction,
  validateChatRequest as _validateChatRequest,
  validateChatResponse as _validateChatResponse,
  validateCompany as _validateCompany,
  validateDeleteAction as _validateDeleteAction,
  validateDeleteUnitAction as _validateDeleteUnitAction,
  validateEditAction as _validateEditAction,
  validateEditUnitAction as _validateEditUnitAction,
  validateHistory as _validateHistory,
  validateOkrDocument as _validateOkrDocument,
  validateOkrNode as _validateOkrNode,
  validateOkrTree as _validateOkrTree,
  validateRelinkAction as _validateRelinkAction
} from './dist/validators.js';

/** Document format version this build reads and writes. */
export { SCHEMA_VERSION };

/**
 * `PACKAGE_VERSION` — version of @okr-agents/schema itself.
 * `RESPOND_INPUT_SCHEMA` — the `respond` tool's input_schema, with every $ref flattened.
 */
export { PACKAGE_VERSION, RESPOND_INPUT_SCHEMA };

/** `migrate(document, fromVersion)` and the MIGRATIONS ladder it walks. */
export { MIGRATIONS, migrate };

// ── rendering Ajv errors ────────────────────────────────────────────────────
//
// Ajv reports the root as '' and nested paths as '/tree/nodes/0/id'. Render
// that as something a human can act on without leaking Ajv's shape.

// Read a value out of `data` by Ajv instancePath ('' is the root).
function at(data, instancePath) {
  if (!instancePath) return data;
  let cur = data;
  for (const raw of instancePath.slice(1).split('/')) {
    if (cur == null) return undefined;
    cur = cur[raw.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return cur;
}

const quote = (v) => JSON.stringify(v);

// Turn Ajv's error objects into "path: message" strings, optionally shifted
// under a prefix so a branch validated on its own still reports the path the
// caller sees (`/actions/0/fields`, not `/fields`).
function renderErrors(errors, prefix = '') {
  if (!errors?.length) return ['failed validation'];

  // Merge allowed values per path: one enum failure per line, not per branch.
  const allowedByPath = new Map();
  for (const e of errors) {
    if (e.keyword !== 'enum' || !Array.isArray(e.params?.allowedValues)) continue;
    const set = allowedByPath.get(e.instancePath) ?? new Set();
    for (const v of e.params.allowedValues) set.add(v);
    allowedByPath.set(e.instancePath, set);
  }

  const seen = new Set();
  const out = [];
  for (const e of errors) {
    const path = prefix + e.instancePath || '/';
    let text;
    if (e.keyword === 'oneOf') continue; // the branch errors already say what is wrong
    else if (e.keyword === 'enum') {
      text = `${path}: must be one of ${[...allowedByPath.get(e.instancePath)].map(quote).join(', ')}`;
    } else if (e.keyword === 'additionalProperties') {
      text = `${path}: unknown property "${e.params.additionalProperty}"`;
    } else {
      text = `${path}: ${e.message ?? 'is invalid'}`;
    }
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.length ? out : [`${prefix || '/'}: failed validation`];
}

// ── actions: oneOf, narrowed by hand ────────────────────────────────────────

const ACTION_BRANCHES = {
  edit: _validateEditAction,
  relink: _validateRelinkAction,
  add: _validateAddAction,
  delete: _validateDeleteAction,
  editUnit: _validateEditUnitAction,
  addUnit: _validateAddUnitAction,
  deleteUnit: _validateDeleteUnitAction
};
const ACTION_OPS = Object.keys(ACTION_BRANCHES);

// Ajv reports a failed oneOf as every branch's complaints at once, and a
// resolved $ref rewrites schemaPath relative to the branch — so there is no way
// to tell from the errors which branch was meant. Read the `op` ourselves and
// validate only that branch.
function actionErrors(value, prefix) {
  const root = prefix || '/';
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${root}: must be an object`];
  if (!('op' in value)) return [`${root}: must have required property 'op'`];
  const branch = ACTION_BRANCHES[value.op];
  if (!branch) return [`${prefix}/op: must be one of ${ACTION_OPS.map(quote).join(', ')}`];
  if (branch(value)) return []; // the branch is happy; the oneOf must have matched more than one
  return renderErrors(branch.errors, prefix);
}

// Replace every oneOf failure over an Action with that branch's own errors.
// Applies to a bare action and to actions nested in a chat response alike.
function refineActionErrors(errors, data) {
  const prefixes = errors.filter((e) => e.keyword === 'oneOf').map((e) => e.instancePath);
  if (!prefixes.length) return renderErrors(errors);
  const untouched = errors.filter((e) => !prefixes.some((p) => e.instancePath.startsWith(p)));
  const refined = prefixes.flatMap((p) => actionErrors(at(data, p), p));
  return [...(untouched.length ? renderErrors(untouched) : []), ...refined];
}

// ── structural validation ───────────────────────────────────────────────────

// The precompiled validators park failures on `.errors`, which is overwritten
// on the next call — so read it immediately.
function wrap(validator, { actions = false } = {}) {
  return (data) => {
    if (validator(data)) return { ok: true, value: data };
    const errors = validator.errors ?? [];
    return { ok: false, errors: actions ? refineActionErrors(errors, data) : renderErrors(errors) };
  };
}

/** @type {(data: unknown) => { ok: true, value: any } | { ok: false, errors: string[] }} */
export const validateOkrDocument = wrap(_validateOkrDocument, { actions: true });
export const validateOkrTree = wrap(_validateOkrTree);
export const validateOkrNode = wrap(_validateOkrNode);
export const validateCompany = wrap(_validateCompany);
export const validateHistory = wrap(_validateHistory, { actions: true });
export const validateAction = wrap(_validateAction, { actions: true });
export const validateChatRequest = wrap(_validateChatRequest);
export const validateChatResponse = wrap(_validateChatResponse, { actions: true });

// ── semantic validation ─────────────────────────────────────────────────────

const LADDER = { company: 0, objective: 1, kr: 2 };

/**
 * Relational checks JSON Schema cannot express. Assumes the tree is already
 * structurally valid; run a validate* first.
 *
 * Errors make the tree unusable. Warnings are style: the level ladder is only
 * a warning because validateResponse and apply.js both allow free relinking,
 * so a tree mid-edit can legitimately sit off-ladder.
 */
export function checkTreeSemantics(tree) {
  const errors = [];
  const warnings = [];
  const nodes = tree?.nodes;
  if (!Array.isArray(nodes)) return { errors: ['/nodes: must be an array'], warnings };

  const byId = new Map();
  for (const [i, n] of nodes.entries()) {
    if (byId.has(n.id)) errors.push(`/nodes/${i}/id: duplicate node id "${n.id}"`);
    else byId.set(n.id, n);
  }

  const roots = nodes.filter((n) => n.parent == null);
  if (!roots.length) errors.push('/nodes: no root node (exactly one node must have parent: null)');
  else if (roots.length > 1) {
    errors.push(`/nodes: ${roots.length} root nodes (${roots.map((n) => n.id).join(', ')}), expected exactly one`);
  }
  for (const r of roots) if (r.level !== 'company') warnings.push(`/nodes: root "${r.id}" has level "${r.level}", expected "company"`);
  for (const n of nodes) {
    if (n.parent == null && n.level === 'company') continue;
    if (n.level === 'company' && n.parent != null) warnings.push(`/nodes: "${n.id}" has level "company" but is not the root`);
  }

  for (const [i, n] of nodes.entries()) {
    if (n.parent == null) continue;
    const parent = byId.get(n.parent);
    if (!parent) {
      errors.push(`/nodes/${i}/parent: "${n.id}" points at missing parent "${n.parent}"`);
      continue;
    }
    if (LADDER[n.level] !== LADDER[parent.level] + 1) {
      warnings.push(`/nodes/${i}/level: "${n.id}" (${n.level}) hangs off "${parent.id}" (${parent.level})`);
    }
  }

  // Walk up from every node; anything that does not terminate at a root is in
  // or below a cycle. Report each cycle once, by its lowest-sorting member.
  const reported = new Set();
  for (const start of nodes) {
    const seen = new Set();
    let cur = start;
    while (cur && cur.parent != null) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      const next = byId.get(cur.parent);
      if (!next) break; // already reported as a missing parent
      if (seen.has(next.id)) {
        const cycle = [...seen].filter((id) => byId.has(id)).sort();
        const key = cycle.join(',');
        if (!reported.has(key)) {
          reported.add(key);
          errors.push(`/nodes: parent cycle through ${cycle.join(' -> ')}`);
        }
        break;
      }
      cur = next;
    }
  }

  return { errors, warnings };
}

/**
 * The same relational checks, over the org rather than the tree: unique unit
 * ids, parents that exist, no parent cycles, a `lead` that names a real person,
 * a person in a real unit.
 *
 * `charter.dependsOn` pointing at a unit that is not there is a warning, not an
 * error: deleting a team leaves every charter that depended on it dangling, and
 * that should not make the document unreadable.
 *
 * @param {unknown} company
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkCompanySemantics(company) {
  const errors = [];
  const warnings = [];
  const units = company?.units;
  if (!Array.isArray(units)) return { errors: ['/units: must be an array'], warnings };

  const byId = new Map();
  for (const [i, u] of units.entries()) {
    if (byId.has(u.id)) errors.push(`/units/${i}/id: duplicate unit id "${u.id}"`);
    else byId.set(u.id, u);
  }

  const people = Array.isArray(company?.people) ? company.people : [];
  const peopleById = new Map();
  for (const [i, p] of people.entries()) {
    if (peopleById.has(p.id)) errors.push(`/people/${i}/id: duplicate person id "${p.id}"`);
    else peopleById.set(p.id, p);
  }

  for (const [i, u] of units.entries()) {
    if (u.parent != null && !byId.has(u.parent)) {
      errors.push(`/units/${i}/parent: "${u.id}" points at missing parent "${u.parent}"`);
    }
    if (u.lead != null && !peopleById.has(u.lead)) {
      errors.push(`/units/${i}/lead: "${u.id}" names missing person "${u.lead}"`);
    }
    for (const [j, dep] of (u.charter?.dependsOn ?? []).entries()) {
      if (!byId.has(dep)) warnings.push(`/units/${i}/charter/dependsOn/${j}: "${u.id}" depends on missing team "${dep}"`);
    }
  }

  for (const [i, p] of people.entries()) {
    if (!byId.has(p.unitId)) errors.push(`/people/${i}/unitId: "${p.id}" is in missing unit "${p.unitId}"`);
  }

  // Same walk as the tree: anything that does not terminate at a top-level unit
  // is in or below a cycle. Report each cycle once, by its lowest-sorting member.
  const reported = new Set();
  for (const start of units) {
    const seen = new Set();
    let cur = start;
    while (cur && cur.parent != null) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      const next = byId.get(cur.parent);
      if (!next) break; // already reported as a missing parent
      if (seen.has(next.id)) {
        const cycle = [...seen].filter((id) => byId.has(id)).sort();
        const key = cycle.join(',');
        if (!reported.has(key)) {
          reported.add(key);
          errors.push(`/units: parent cycle through ${cycle.join(' -> ')}`);
        }
        break;
      }
      cur = next;
    }
  }

  return { errors, warnings };
}

/**
 * Do the tree's `unitId` pointers land on teams that exist? Warnings only,
 * never errors: a tree mid-edit can legitimately dangle (a team was deleted,
 * or the document simply has no `company`), and a dangling unitId costs nothing
 * more than a node rendering its `owner` text instead of a team link.
 *
 * @param {unknown} tree
 * @param {unknown} company
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkOwnership(tree, company) {
  const warnings = [];
  const nodes = tree?.nodes;
  if (!Array.isArray(nodes)) return { errors: [], warnings };
  const known = new Set((Array.isArray(company?.units) ? company.units : []).map((u) => u.id));
  for (const [i, n] of nodes.entries()) {
    if (n.unitId == null) continue;
    if (!known.has(n.unitId)) warnings.push(`/nodes/${i}/unitId: "${n.id}" is owned by missing team "${n.unitId}"`);
  }
  return { errors: [], warnings };
}

// ── documents ───────────────────────────────────────────────────────────────

/**
 * Stamp a tree (and optionally company/history) into an exportable document.
 * @returns {object} an OkrDocument at the current SCHEMA_VERSION
 */
export function createDocument({ tree, company, history, meta } = {}) {
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      ...meta,
      exportedAt: meta?.exportedAt ?? new Date().toISOString(),
      generator: meta?.generator ?? `@okr-agents/schema ${PACKAGE_VERSION}`
    },
    tree
  };
  if (company !== undefined) doc.company = company;
  if (history !== undefined) doc.history = history;
  return doc;
}

/**
 * Read a document written by createDocument: parse, version-check, migrate,
 * validate structurally, then check semantics.
 *
 * @param {string | object} input JSON text or an already-parsed object
 * @returns {{ ok: true, document: object, warnings: string[] }
 *         | { ok: false, errors: string[], warnings: string[] }}
 */
export function parseDocument(input) {
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [`/: not valid JSON (${err.message})`], warnings: [] };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['/: expected a JSON object'], warnings: [] };
  }

  const version = raw.schemaVersion;
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ['/schemaVersion: must be an integer >= 1'], warnings: [] };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `/schemaVersion: this file is version ${version}, but this build only reads up to ${SCHEMA_VERSION}. Update the app.`
      ],
      warnings: []
    };
  }

  let document = raw;
  if (version < SCHEMA_VERSION) {
    const migrated = migrate(document, version);
    if (!migrated.ok) return { ok: false, errors: migrated.errors, warnings: [] };
    document = migrated.document;
  }

  const structural = validateOkrDocument(document);
  if (!structural.ok) return { ok: false, errors: structural.errors, warnings: [] };

  const { errors, warnings } = checkTreeSemantics(document.tree);
  if (document.company) {
    const org = checkCompanySemantics(document.company);
    errors.push(...org.errors);
    warnings.push(...org.warnings);
  }
  // Runs with or without a company: a document that carries unitId but no
  // company should say so rather than pass silently.
  warnings.push(...checkOwnership(document.tree, document.company).warnings);
  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, document, warnings };
}
