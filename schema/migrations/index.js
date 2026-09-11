// One function per major step of the document format.
//
// MIGRATIONS[n] upgrades a document written at schemaVersion n to n + 1. It
// receives a document it may mutate freely (parseDocument hands it a value the
// caller has already given up) and returns the upgraded document.
//
// v1 is the first format, so the ladder is empty. When SCHEMA_VERSION becomes
// 2, add MIGRATIONS[1] here and a round-trip fixture under test/fixtures/.

import { SCHEMA_VERSION } from '../version.js';

/** @type {Record<number, (document: any) => any>} */
export const MIGRATIONS = {};

/**
 * Walk a document up the ladder from `fromVersion` to the current version.
 *
 * @param {object} document
 * @param {number} fromVersion the document's own schemaVersion
 * @returns {{ ok: true, document: object } | { ok: false, errors: string[] }}
 */
export function migrate(document, fromVersion) {
  let current = document;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      return {
        ok: false,
        errors: [`/schemaVersion: no migration from version ${v} to ${v + 1}; this file is too old to read.`]
      };
    }
    try {
      current = step(current);
    } catch (err) {
      return { ok: false, errors: [`/schemaVersion: migration ${v} -> ${v + 1} failed (${err.message})`] };
    }
    current.schemaVersion = v + 1;
  }
  return { ok: true, document: current };
}
