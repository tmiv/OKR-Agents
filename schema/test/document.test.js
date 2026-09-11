// createDocument → JSON → parseDocument is the export/import path the web app
// uses, so it is tested as a round trip rather than a pair of units.

import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIGRATIONS,
  PACKAGE_VERSION,
  SCHEMA_VERSION,
  checkTreeSemantics,
  createDocument,
  parseDocument,
  validateOkrTree
} from '../index.js';

// The tree the app boots with. datasets.test.js validates every bundled
// document; here it is the fixture the round trips run on, so a real tree with
// real edge cases goes through createDocument/parseDocument.
const defaultDocument = JSON.parse(
  readFileSync(new URL('../../web/src/assets/datasets/workflow-platform-fy26.json', import.meta.url))
);
const defaultTree = defaultDocument.tree;
// Its nodes carry unitId, so the org has to travel with the tree: a document
// with unitId and no company parses, but warns on every node.
const defaultCompany = defaultDocument.company;

test('the default dataset’s tree is valid and raises no warnings', () => {
  const structural = validateOkrTree(defaultTree);
  assert.ok(structural.ok, `the default dataset failed validation:\n  ${structural.errors?.join('\n  ')}`);
  assert.deepEqual(checkTreeSemantics(defaultTree), { errors: [], warnings: [] });
});

test('createDocument stamps version, timestamp and generator', () => {
  const before = Date.now();
  const doc = createDocument({ tree: defaultTree });
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.equal(doc.generator, undefined, 'generator belongs under meta');
  assert.equal(doc.meta.generator, `@okr-viewer/schema ${PACKAGE_VERSION}`);
  assert.ok(Date.parse(doc.meta.exportedAt) >= before - 1000);
  assert.equal('company' in doc, false, 'absent sections stay absent rather than becoming undefined');
  assert.equal('history' in doc, false);
});

test('caller meta survives, but exportedAt and generator are filled in', () => {
  const doc = createDocument({ tree: defaultTree, meta: { title: 'Acme FY26', period: 'FY26' } });
  assert.equal(doc.meta.title, 'Acme FY26');
  assert.equal(doc.meta.period, 'FY26');
  assert.ok(doc.meta.exportedAt);
});

test('round trip through JSON preserves the tree exactly', () => {
  const doc = createDocument({ tree: defaultTree, company: defaultCompany, meta: { title: 'Round trip' } });
  const out = parseDocument(JSON.stringify(doc, null, 2));
  assert.ok(out.ok, `round trip failed:\n  ${out.errors?.join('\n  ')}`);
  assert.deepEqual(out.document.tree, defaultTree);
  assert.deepEqual(out.document.company, defaultCompany);
  assert.deepEqual(out.warnings, []);
});

test('parseDocument accepts an already-parsed object', () => {
  const out = parseDocument(createDocument({ tree: defaultTree }));
  assert.ok(out.ok);
});

test('a company and history round trip too', () => {
  const company = { name: 'Acme', units: [{ id: 'u-1', name: 'Engineering', parent: null }] };
  const history = {
    metricSamples: [{ nodeId: 'kr-1', at: '2026-09-01T00:00:00Z', value: 11 }],
    changes: [
      {
        at: '2026-09-02T10:30:00Z',
        actor: 'assistant',
        reason: 'Made it measurable.',
        actions: [{ op: 'edit', id: 'kr-1', fields: { target: '14 -> 5 by Q4' } }]
      }
    ]
  };
  const out = parseDocument(JSON.stringify(createDocument({ tree: defaultTree, company, history })));
  assert.ok(out.ok, `failed:\n  ${out.errors?.join('\n  ')}`);
  assert.deepEqual(out.document.company, company);
  assert.deepEqual(out.document.history, history);
});

test('a newer schemaVersion is refused with a clear message', () => {
  const doc = { ...createDocument({ tree: defaultTree }), schemaVersion: SCHEMA_VERSION + 1 };
  const out = parseDocument(doc);
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /version 2, but this build only reads up to 1/);
});

test('an older schemaVersion with no migration is refused, not silently accepted', () => {
  assert.deepEqual(MIGRATIONS, {}, 'v1 is the first format, so the ladder starts empty');
  const out = parseDocument({ ...createDocument({ tree: defaultTree }), schemaVersion: 0 });
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /must be an integer >= 1/);
});

test('malformed JSON is reported, not thrown', () => {
  const out = parseDocument('{ not json');
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /^\/: not valid JSON/);
});

test('a non-object document is refused', () => {
  for (const input of ['[]', '"hello"', '42', 'null']) {
    const out = parseDocument(input);
    assert.equal(out.ok, false, `expected ${input} to be refused`);
  }
});

test('a structurally valid but semantically broken tree is refused', () => {
  const doc = createDocument({
    tree: { nodes: [{ id: 'a', level: 'kr', parent: 'ghost', label: 'orphan' }] }
  });
  const out = parseDocument(doc);
  assert.equal(out.ok, false);
  assert.match(out.errors.join('\n'), /missing parent "ghost"/);
});

test('warnings come back on success without blocking the import', () => {
  const doc = createDocument({
    tree: { nodes: [{ id: 'co-1', level: 'company', parent: null, label: 'Root' }, { id: 'kr-1', level: 'kr', parent: 'co-1', label: 'Skips a level' }] }
  });
  const out = parseDocument(doc);
  assert.ok(out.ok, `expected a warning, not a failure:\n  ${out.errors?.join('\n  ')}`);
  assert.equal(out.warnings.length, 1);
});
